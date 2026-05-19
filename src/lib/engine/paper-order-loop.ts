import { db } from '@/lib/db';
import { updateOrderCompat } from '@/lib/engine/prisma-runtime-compat';
import { resolvePaperFill } from '@/lib/engine/paper-execution';
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
const IDLE_CYCLE_THRESHOLD = 5;
const ALLOW_SYNTHETIC_TEST_ORDERS = process.env.ALLOW_SYNTHETIC_PAPER_TEST_ORDERS === 'true';

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

async function ensureTestMarketExists(): Promise<string | null> {
  const existing = await db.market.findFirst({
    where: { externalId: 'PAPER_TEST_MARKET' },
  });
  if (existing) return existing.id;

  try {
    const market = await db.market.create({
      data: {
        id: `paper-test-${Date.now()}`,
        externalId: 'PAPER_TEST_MARKET',
        venue: 'PAPER',
        title: 'Test V2: Paper Orders should work in paper mode',
        description: 'Auto-generated paper test market for continuous order loop demo',
        category: 'test',
        status: 'ACTIVE',
        dataSource: 'REAL' as any,
      },
    });
    console.log('[PaperLoop] Created test market:', market.id);
    return market.id;
  } catch {
    return null;
  }
}

async function generateTestOrder(): Promise<string | null> {
  const marketId = await ensureTestMarketExists();
  if (!marketId) return null;

  const venueOrderId = `PAPER_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const price = 0.6;
  const size = 100;

  try {
    const order = await db.order.create({
      data: {
        marketId,
        venueOrderId,
        executionMode: 'SIMULATED' as any,
        dataSource: 'MOCK' as any,
        lifecycleStatus: 'SUBMITTED' as any,
        side: 'YES',
        price,
        size,
        filledSize: 0,
        remainingSize: size,
        status: 'SUBMITTED',
        fillAttemptCount: 0,
        fillModel: 'DEMO_INSTANT',
        submittedAt: new Date(),
        orderExpiryAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      } as any,
    });

    // Ensure paperBet exists for the new order
    await ensurePaperBetExists({
      orderId: order.id,
      marketId,
      fillTimestamp: new Date(),
      side: 'YES',
      price,
      size,
      avgFillPrice: price,
      executionStatus: 'SUBMITTED',
    });

    console.log(`[PaperLoop] Generated test order: ${order.id}`);
    return order.id;
  } catch (err) {
    console.error('[PaperLoop] Failed to generate test order:', err);
    return null;
  }
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

    const fillResult = resolvePaperFill({
      size: order.remainingSize ?? order.size,
      price: order.price,
      fillModel: 'DEMO_INSTANT' as FillModelInput,
      liquidity: 999999,
    });

    const fillTimestamp = new Date();
    const currentAttempt = (order.fillAttemptCount ?? 0) + 1;
    const prevFilledSize = order.filledSize ?? 0;
    const incrementalFill = Math.max(0, fillResult.filledSize);
    const nextFilledSize = Math.min(order.size, prevFilledSize + incrementalFill);
    const nextRemainingSize = Math.max(0, order.size - nextFilledSize);
    const nextAvgFillPrice =
      nextFilledSize > 0
        ? (((order.avgFillPrice ?? 0) * prevFilledSize) + (fillResult.avgFillPrice * incrementalFill)) / Math.max(nextFilledSize, 1)
        : order.avgFillPrice;

    const isFullFill = nextFilledSize >= order.size * 0.999;
    const newLifecycleStatus = isFullFill ? 'FILLED' : 'PARTIALLY_FILLED';
    const paperBetExecutionStatus = derivePaperBetExecutionStatus({
      lifecycleStatus: newLifecycleStatus as any,
      filledSize: nextFilledSize,
    });

    await updateOrderCompat(orderId, {
      lifecycleStatus: newLifecycleStatus,
      filledSize: nextFilledSize,
      remainingSize: nextRemainingSize,
      avgFillPrice: nextAvgFillPrice,
      filledAt: newLifecycleStatus === 'FILLED' ? fillTimestamp : null,
      lastFillAttemptAt: fillTimestamp,
      fillAttemptCount: { increment: 1 },
      status: newLifecycleStatus === 'FILLED' ? 'FILLED' : 'PARTIALLY_FILLED',
      failureReason: null,
    });

    if (incrementalFill > 0) {
      await db.fill.create({
        data: {
          orderId,
          price: fillResult.avgFillPrice,
          size: incrementalFill,
          fee: 0,
          fillModel: 'DEMO_INSTANT',
          metadataJson: JSON.stringify({
            mode: 'PAPER_LOOP',
            liquidity: 999999,
            fillProbability: 1.0,
            fillAttempt: currentAttempt,
          }),
          fillTime: fillTimestamp,
        },
      });

      // Always ensure PaperBet exists (creates if missing)
      await ensurePaperBetExists({
        orderId,
        marketId: order.marketId,
        fillTimestamp,
        side: order.side,
        price: order.price,
        size: nextFilledSize,
        avgFillPrice: nextAvgFillPrice ?? order.price,
        executionStatus: paperBetExecutionStatus,
      });

      const existingPosition = await db.position.findFirst({
        where: { marketId: order.marketId, status: { in: ['OPEN', 'WATCH'] } },
      });

      if (!existingPosition) {
        await db.position.create({
          data: {
            marketId: order.marketId,
            side: order.side,
            entryPrice: fillResult.avgFillPrice,
            currentSize: incrementalFill,
            avgEntryPrice: fillResult.avgFillPrice,
            unrealizedPnl: 0,
            realizedPnl: 0,
            status: 'OPEN',
            openedAt: fillTimestamp,
          },
        });
      } else {
        const newSize = existingPosition.currentSize + incrementalFill;
        const newAvgPrice = ((existingPosition.avgEntryPrice * existingPosition.currentSize) + (fillResult.avgFillPrice * incrementalFill)) / newSize;
        await db.position.update({
          where: { id: existingPosition.id },
          data: {
            currentSize: newSize,
            avgEntryPrice: newAvgPrice,
            status: 'OPEN',
          },
        });
      }
    }

    if (newLifecycleStatus === 'FILLED') {
      await db.tradeCandidate.updateMany({
        where: { marketId: order.marketId },
        data: { stage: 'EXECUTED', lastExecutionAt: fillTimestamp },
      });
    }

    return {
      orderId,
      venueOrderId: order.venueOrderId ?? "",
      marketId: order.marketId,
      side: order.side,
      price: order.price,
      size: order.size,
      filledSize: incrementalFill,
      avgFillPrice: fillResult.avgFillPrice,
      remainingSize: nextRemainingSize,
      isFullyFilled: newLifecycleStatus === 'FILLED',
      lifecycleStatus: newLifecycleStatus,
      paperBetStatus: paperBetExecutionStatus,
      attemptNumber: currentAttempt,
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

let _idleCycleCount = 0;

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

    if (orders.length === 0) {
      _idleCycleCount++;
      if (ALLOW_SYNTHETIC_TEST_ORDERS && _idleCycleCount >= IDLE_CYCLE_THRESHOLD) {
        const newOrderId = await generateTestOrder();
        if (newOrderId) {
          _idleCycleCount = 0;
          generated = 1;
          // Fill it immediately
          try {
            const fillResult = await fillPaperOrder(newOrderId);
            results.push(fillResult);
            if (fillResult.lifecycleStatus === 'FILLED') filled++;
          } catch {
            failed++;
          }
        }
      }
    } else {
      _idleCycleCount = 0;
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
  _idleCycleCount = 0;

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
  _idleCycleCount = 0;
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
