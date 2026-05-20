import { db } from '@/lib/db';
import { updateOrderCompat } from '@/lib/engine/prisma-runtime-compat';
import { normalizeFillModel } from '@/lib/engine/paper-execution';
import { processPaperOrderFill } from '@/lib/engine/order-tracker';
import { derivePaperBetExecutionStatus } from '@/lib/engine/order-tracker';
import type { FillModelInput, PaperBetExecutionStatus } from '@/lib/types';

export type PaperLoopStatus = 'STOPPED' | 'RUNNING' | 'PAUSED';

export interface PaperLoopState {
  status: PaperLoopStatus;
  ordersProcessed: number;
  ordersFilled: number;
  ordersFailed: number;
  lastCycleAt: string | null;
  currentCycle: number;
  errors: number;
  lastError: string | null;
  intervalMs: number;
  autoStarted: boolean;
}

const state: PaperLoopState = {
  status: 'STOPPED',
  ordersProcessed: 0,
  ordersFilled: 0,
  ordersFailed: 0,
  lastCycleAt: null,
  currentCycle: 0,
  errors: 0,
  lastError: null,
  intervalMs: 3000,
  autoStarted: false,
};

let intervalHandle: ReturnType<typeof setInterval> | null = null;
const PROCESSING_LOCK = new Set<string>();

// True when paper loop should own order filling (worker ORDER_TRACK backs off)
let _paperLoopActive = false;
export function isPaperLoopActive(): boolean {
  return _paperLoopActive;
}

export function getPaperLoopState(): PaperLoopState {
  return { ...state };
}

// ── Core Fill Logic ──────────────────────────────────────────────────

export interface PaperFillResult {
  orderId: string;
  venueOrderId: string;
  marketId: string;
  side: string;
  price: number;
  size: number;
  filledSize: number;
  avgFillPrice: number;
  remainingSize: number;
  isFullyFilled: boolean;
  lifecycleStatus: string;
  paperBetStatus: PaperBetExecutionStatus;
  attemptNumber: number;
}

async function ensurePaperBetExists(params: {
  orderId: string;
  marketId: string;
  fillTimestamp: Date;
  side: string;
  price: number;
  size: number;
  avgFillPrice: number;
  executionStatus: PaperBetExecutionStatus;
}): Promise<void> {
  const existing = await db.paperBet.findFirst({
    where: { orderId: params.orderId },
  });

  if (existing) {
    await db.paperBet.update({
      where: { id: existing.id },
      data: {
        executionStatus: params.executionStatus,
        executedAt: params.executionStatus === 'FILLED' ? params.fillTimestamp : undefined,
        stake: params.size,
        entryPrice: params.avgFillPrice ?? params.price,
      },
    });
    return;
  }

  const order = await db.order.findUnique({
    where: { id: params.orderId },
    select: { marketId: true },
  });

  // Find an existing decision with PAPER mode for this market, or create minimal paperBet without decision link
  const decision = await db.decision.findFirst({
    where: { marketId: order?.marketId ?? params.marketId, mode: 'PAPER' as any },
    orderBy: { createdAt: 'desc' },
  });

  if (decision) {
    const existingBet = await db.paperBet.findFirst({
      where: { decisionId: decision.id },
    });
    if (existingBet) {
      await db.paperBet.update({
        where: { id: existingBet.id },
        data: {
          orderId: params.orderId,
          executionStatus: params.executionStatus,
          executedAt: params.executionStatus === 'FILLED' ? params.fillTimestamp : undefined,
          stake: params.size,
          entryPrice: params.avgFillPrice ?? params.price,
        },
      });
      return;
    }
    // Guard: verify market exists before creating paper bet (prevents FK violation)
    const marketExists = await db.market.findUnique({ where: { id: params.marketId }, select: { id: true } });
    if (!marketExists) {
      console.error(`[PaperLoop] FK guard: market ${params.marketId} not found, skipping paper bet creation for order ${params.orderId}`);
      return;
    }
    await db.paperBet.create({
      data: {
        marketId: params.marketId,
        decisionId: decision.id,
        orderId: params.orderId,
        predictionType: 'BID',
        predictedProb: 0.65,
        predictedSide: params.side,
        impliedProb: params.price,
        edge: 0.05,
        confidence: 0.7,
        stake: params.size,
        entryPrice: params.avgFillPrice ?? params.price,
        executionStatus: params.executionStatus,
        executedAt: params.executionStatus === 'FILLED' ? params.fillTimestamp : undefined,
        setupType: 'STANDARD_BET',
        aPlusStatus: 'HEURISTIC',
      },
    });
    console.log(`[PaperLoop] Created PaperBet for order ${params.orderId} (linked to decision ${decision.id})`);
    return;
  }

  // No decision — create a minimal one first
  const marketExists2 = await db.market.findUnique({ where: { id: params.marketId }, select: { id: true } });
  if (!marketExists2) {
    console.error(`[PaperLoop] FK guard: market ${params.marketId} not found, skipping decision+bet creation for order ${params.orderId}`);
    return;
  }
  const newDecision = await db.decision.create({
    data: {
      marketId: params.marketId,
      action: 'BID',
      side: params.side,
      reasonCode: 'PAPER_LOOP_AUTO',
      mode: 'PAPER' as any,
      impliedProb: params.price,
      confidence: 0.7,
    },
  });

  await db.paperBet.create({
    data: {
      marketId: params.marketId,
      decisionId: newDecision.id,
      orderId: params.orderId,
      predictionType: 'BID',
      predictedProb: 0.65,
      predictedSide: params.side,
      impliedProb: params.price,
      edge: 0.05,
      confidence: 0.7,
      stake: params.size,
      entryPrice: params.avgFillPrice ?? params.price,
      executionStatus: params.executionStatus,
      executedAt: params.executionStatus === 'FILLED' ? params.fillTimestamp : undefined,
      setupType: 'STANDARD_BET',
      aPlusStatus: 'HEURISTIC',
    },
  });
  console.log(`[PaperLoop] Created Decision+PaperBet for order ${params.orderId} (no existing decision found)`);
}

export async function fillPaperOrder(orderId: string): Promise<PaperFillResult> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  // Race condition guard
  if (PROCESSING_LOCK.has(orderId)) {
    console.log(`[PaperLoop] Order ${orderId} already being processed, skipping`);
    return {
      orderId,
      venueOrderId: order.venueOrderId ?? "",
      marketId: order.marketId,
      side: order.side,
      price: order.price,
      size: order.size,
      filledSize: order.filledSize ?? 0,
      avgFillPrice: order.avgFillPrice ?? 0,
      remainingSize: order.remainingSize ?? 0,
      isFullyFilled: order.lifecycleStatus === 'FILLED',
      lifecycleStatus: order.lifecycleStatus,
      paperBetStatus: 'SUBMITTED',
      attemptNumber: order.fillAttemptCount ?? 0,
    };
  }

  PROCESSING_LOCK.add(orderId);
  try {
    const terminalStates = ['FILLED', 'CANCELLED', 'EXPIRED', 'FAILED'];
    if (terminalStates.includes(order.lifecycleStatus)) {
      return {
        orderId,
        venueOrderId: order.venueOrderId ?? "",
        marketId: order.marketId,
        side: order.side,
        price: order.price,
        size: order.size,
        filledSize: order.filledSize ?? 0,
        avgFillPrice: order.avgFillPrice ?? 0,
        remainingSize: order.remainingSize ?? 0,
        isFullyFilled: order.lifecycleStatus === 'FILLED',
        lifecycleStatus: order.lifecycleStatus,
        paperBetStatus: 'FILLED',
        attemptNumber: order.fillAttemptCount ?? 0,
      };
    }

    if (order.orderExpiryAt && order.orderExpiryAt < new Date()) {
      await updateOrderCompat(orderId, {
        lifecycleStatus: 'EXPIRED',
        status: 'EXPIRED',
        expiredAt: new Date(),
        lastFillAttemptAt: new Date(),
        fillAttemptCount: { increment: 1 },
      });
      await db.paperBet.updateMany({
        where: { orderId },
        data: { executionStatus: 'EXPIRED' },
      });
      return {
        orderId,
        venueOrderId: order.venueOrderId ?? "",
        marketId: order.marketId,
        side: order.side,
        price: order.price,
        size: order.size,
        filledSize: 0, avgFillPrice: 0,
        remainingSize: order.remainingSize ?? order.size,
        isFullyFilled: false,
        lifecycleStatus: 'EXPIRED',
        paperBetStatus: 'EXPIRED',
        attemptNumber: (order.fillAttemptCount ?? 0) + 1,
      };
    }

    const [latestOrderbook, marketSnapshot] = await Promise.all([
      db.orderbookSnapshot.findFirst({
        where: { marketId: order.marketId },
        orderBy: { capturedAt: 'desc' },
      }),
      db.marketSnapshot.findFirst({
        where: { marketId: order.marketId },
        orderBy: { capturedAt: 'desc' },
      }),
    ]);

    const previousFilledSize = order.filledSize ?? 0;
    const result = await processPaperOrderFill({
      orderId,
      marketId: order.marketId,
      fillModel: normalizeFillModel(order.fillModel as FillModelInput),
      liquidity: marketSnapshot?.liquidity ?? 0,
      fillProbability: latestOrderbook?.fillProbability ?? marketSnapshot?.fillProbability ?? null,
      priceImpact: latestOrderbook?.priceImpact ?? marketSnapshot?.priceImpact ?? null,
      bidDepth: latestOrderbook?.bidDepth ?? marketSnapshot?.bidDepth ?? null,
      askDepth: latestOrderbook?.askDepth ?? marketSnapshot?.askDepth ?? null,
      spread: latestOrderbook?.spread ?? marketSnapshot?.spread ?? null,
    });

    const updatedOrder = await db.order.findUnique({ where: { id: orderId } });
    const filledSize = Math.max(0, (updatedOrder?.filledSize ?? previousFilledSize) - previousFilledSize);
    const lifecycleStatus = updatedOrder?.lifecycleStatus ?? result.orderStatus;
    const paperBetStatus = derivePaperBetExecutionStatus({
      lifecycleStatus: lifecycleStatus as any,
      filledSize: updatedOrder?.filledSize ?? 0,
    });

    return {
      orderId,
      venueOrderId: order.venueOrderId ?? "",
      marketId: order.marketId,
      side: order.side,
      price: order.price,
      size: order.size,
      filledSize,
      avgFillPrice: updatedOrder?.avgFillPrice ?? result.avgFillPrice,
      remainingSize: updatedOrder?.remainingSize ?? Math.max(0, order.size - (updatedOrder?.filledSize ?? 0)),
      isFullyFilled: lifecycleStatus === 'FILLED',
      lifecycleStatus,
      paperBetStatus,
      attemptNumber: updatedOrder?.fillAttemptCount ?? ((order.fillAttemptCount ?? 0) + 1),
    };
  } finally {
    PROCESSING_LOCK.delete(orderId);
  }
}

// ── Loop Cycle ────────────────────────────────────────────────────────

export interface PaperLoopCycleResult {
  cycle: number;
  timestamp: string;
  totalOrders: number;
  filled: number;
  alreadyTerminal: number;
  failed: number;
  generated: number;
  results: PaperFillResult[];
}

export async function runPaperLoopCycle(): Promise<PaperLoopCycleResult> {
  state.currentCycle++;
  const cycle = state.currentCycle;
  const timestamp = new Date().toISOString();

  try {
    const orders = await db.order.findMany({
      where: {
        lifecycleStatus: { in: ['PLANNED', 'SUBMITTED', 'PARTIALLY_FILLED'] },
      },
      orderBy: { submittedAt: 'asc' },
    });

    const results: PaperFillResult[] = [];
    let filled = 0;
    let alreadyTerminal = 0;
    let failed = 0;
    let generated = 0;

    if (orders.length > 0) {
      for (const order of orders) {
        try {
          const result = await fillPaperOrder(order.id);
          results.push(result);
          if (result.lifecycleStatus === 'FILLED') filled++;
          else if (['FILLED', 'CANCELLED', 'EXPIRED'].includes(result.lifecycleStatus)) alreadyTerminal++;
        } catch (err) {
          failed++;
          state.errors++;
          state.lastError = err instanceof Error ? err.message : String(err);
          console.error(`[PaperLoop] Failed to process order ${order.id}:`, err);
        }
      }
    }

    state.ordersProcessed += orders.length + generated;
    state.ordersFilled += filled;
    state.ordersFailed += failed;
    state.lastCycleAt = timestamp;

    return {
      cycle, timestamp,
      totalOrders: orders.length + generated,
      filled, alreadyTerminal, failed, generated,
      results,
    };
  } catch (err) {
    state.errors++;
    state.lastError = err instanceof Error ? err.message : String(err);
    state.lastCycleAt = timestamp;
    throw err;
  }
}

// ── Loop Control ──────────────────────────────────────────────────────

export function startPaperLoop(intervalMs: number = 3000): PaperLoopState {
  if (state.status === 'RUNNING') {
    // Update interval if already running
    state.intervalMs = intervalMs;
    if (intervalHandle) { clearInterval(intervalHandle); }
    intervalHandle = setInterval(tick, intervalMs);
    return { ...state };
  }
  state.status = 'RUNNING';
  state.intervalMs = intervalMs;
  state.lastError = null;
  _paperLoopActive = true;

  runPaperLoopCycle().catch((err) => {
    console.error('[PaperLoop] Initial cycle error:', err);
  });

  intervalHandle = setInterval(tick, intervalMs);
  console.log(`[PaperLoop] Started — interval=${intervalMs}ms`);
  return { ...state };
}

export function stopPaperLoop(): PaperLoopState {
  state.status = 'STOPPED';
  _paperLoopActive = false;
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  state.lastCycleAt = new Date().toISOString();
  console.log('[PaperLoop] Stopped');
  return { ...state };
}

export function pausePaperLoop(): PaperLoopState {
  state.status = 'PAUSED';
  _paperLoopActive = false;
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
  state.lastCycleAt = new Date().toISOString();
  console.log('[PaperLoop] Paused');
  return { ...state };
}

export function resetPaperLoopStats(): PaperLoopState {
  state.ordersProcessed = 0;
  state.ordersFilled = 0;
  state.ordersFailed = 0;
  state.currentCycle = 0;
  state.errors = 0;
  state.lastError = null;
  return { ...state };
}

export async function fillAllPendingPaperOrders(): Promise<PaperLoopCycleResult> {
  console.log('[PaperLoop] One-shot fill all pending orders...');
  return runPaperLoopCycle();
}

// ── Internal tick ─────────────────────────────────────────────────────

function tick() {
  if (state.status !== 'RUNNING') return;
  runPaperLoopCycle().catch((err) => {
    console.error('[PaperLoop] Cycle error:', err);
  });
}

// ── Auto-start detection ──────────────────────────────────────────────

let _autoStarted = false;

export async function ensurePaperLoopRunning(): Promise<PaperLoopState> {
  if (state.status === 'RUNNING') return { ...state };

  try {
    const modeSetting = await db.settings.findUnique({ where: { key: 'trading_mode' } });
    const mode = modeSetting?.value ?? null;
    if (mode === 'PAPER') {
      _autoStarted = true;
      const s = startPaperLoop(3000);
      s.autoStarted = true;
      return s;
    }
  } catch (err) {
    console.error('[PaperLoop] Auto-start check failed:', err);
  }

  return { ...state };
}
