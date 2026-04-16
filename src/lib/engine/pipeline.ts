import { db } from '@/lib/db';
import { computeRisk } from '@/lib/engine/risk';
import { runTriageAgent } from '@/lib/engine/agents/triage';
import { runBullAgent } from '@/lib/engine/agents/bull';
import { runBearAgent } from '@/lib/engine/agents/bear';
import { runContradictionAgent } from '@/lib/engine/agents/contradiction';
import { runJudgeAgent } from '@/lib/engine/agents/judge';
import { searchSearXNG } from '@/lib/engine/research/search';
import { extractContent } from '@/lib/engine/research/extract';
import { writeResearchToQdrant, retrieveSimilarMarkets } from '@/lib/engine/memory/qdrant';
import { isTestMode } from '@/lib/engine/mode';
import type { JudgeOutput } from '@/lib/types';

export interface PipelineResult {
  [key: string]: unknown;
  marketId: string;
  triageStatus: string;
  judgeOutput: JudgeOutput | null;
  riskAction: 'BUY' | 'SKIP' | null;
  orderId: string | null;
  error: string | null;
  stages: string[];
}

export async function runPipelineForMarket(marketId: string): Promise<PipelineResult> {
  const result: PipelineResult = {
    marketId,
    triageStatus: 'PENDING',
    judgeOutput: null,
    riskAction: null,
    orderId: null,
    error: null,
    stages: [],
  };

  try {
    const market = await db.market.findUnique({
      where: { id: marketId },
      include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
    });
    if (!market) {
      result.error = `Market ${marketId} not found`;
      return result;
    }

    const snapshot = market.snapshots[0];
    const impliedProb = snapshot?.impliedProb ?? 0.5;
    const liquidity = snapshot?.liquidity ?? 0;

    result.stages.push('TRIAGE');
    const triageResult = await runTriageAgent(
      marketId, market.title, market.description || '', market.category, impliedProb, liquidity
    );
    result.triageStatus = triageResult.status;

    const candidate = await db.tradeCandidate.findFirst({ where: { marketId } });
    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: {
          stage: 'TRIAGED',
          triageStatus: triageResult.status,
          triageReason: triageResult.reason,
          researchQueued: triageResult.worthResearch,
        },
      });
    }

    if (!triageResult.worthResearch) {
      result.stages.push('SKIPPED_TRIAGE');
      return result;
    }

    result.stages.push('RESEARCH');
    const searchResults = await searchSearXNG(market.title, 5);
    const researchContext = searchResults.map((r) => `${r.title}: ${r.snippet}`).join('\n');

    const researchRun = await db.researchRun.create({
      data: {
        marketId,
        candidateId: candidate?.id || null,
        status: 'RUNNING',
        depth: 'DEEP',
        startedAt: new Date(),
      },
    });

    for (const sr of searchResults) {
      const extracted = await extractContent(sr.url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db.researchSource.create as any)({
        data: {
          researchRunId: researchRun.id,
          url: sr.url,
          title: sr.title,
          content: extracted?.content || sr.snippet,
          sourceType: sr.sourceType,
          recencyScore: sr.recencyScore,
          qualityScore: sr.qualityScore,
        },
      });
    }

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'RESEARCHING' },
      });
    }

    await retrieveSimilarMarkets(market.title, market.description || '');

    result.stages.push('BULL');
    const bull = await runBullAgent(marketId, market.title, impliedProb, researchContext);
    await db.agentOutput.create({
      data: {
        researchRunId: researchRun.id, role: 'BULL', modelUsed: 'llm',
        promptVersion: '1', output: JSON.stringify(bull),
        tokenCount: 0, latencyMs: 0,
      },
    });

    result.stages.push('BEAR');
    const bear = await runBearAgent(marketId, market.title, impliedProb, researchContext);
    await db.agentOutput.create({
      data: {
        researchRunId: researchRun.id, role: 'BEAR', modelUsed: 'llm',
        promptVersion: '1', output: JSON.stringify(bear),
        tokenCount: 0, latencyMs: 0,
      },
    });

    result.stages.push('CONTRADICTION');
    const contradiction = await runContradictionAgent(marketId, market.title, bull, bear);
    await db.agentOutput.create({
      data: {
        researchRunId: researchRun.id, role: 'CONTRADICTION', modelUsed: 'llm',
        promptVersion: '1', output: JSON.stringify(contradiction),
        tokenCount: 0, latencyMs: 0,
      },
    });

    await db.researchRun.update({
      where: { id: researchRun.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    result.stages.push('JUDGE');
    const judgeOutput = await runJudgeAgent(
      marketId, market.title, impliedProb, bull, bear, contradiction
    );
    result.judgeOutput = judgeOutput;

    await db.agentOutput.create({
      data: {
        researchRunId: researchRun.id, role: 'JUDGE', modelUsed: 'llm',
        promptVersion: '1', output: JSON.stringify(judgeOutput),
        tokenCount: 0, latencyMs: 0,
      },
    });

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'JUDGED' },
      });
    }

    result.stages.push('RISK');
    const strategySetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    const strategy = strategySetting ? JSON.parse(strategySetting.value) : {};

    const riskInput = {
      impliedProbability: impliedProb,
      judgeProbability: judgeOutput.trueProbability,
      confidence: judgeOutput.confidence,
      uncertainty: judgeOutput.uncertainty,
      fees: 0.02,
      slippage: 0.01,
      venue: market.venue as 'POLYMARKET' | 'KALSHI' | 'SX_BET' | 'MANIFOLD',
      category: market.category,
      dailyExposure: strategy.maxDailyExposure ?? 50000,
      categoryExposure: 0,
      openPositions: await db.position.count({ where: { status: 'OPEN' } }),
      marketLiquidity: liquidity,
      marketSpread: snapshot?.spread ?? 0.05,
      catalystTiming: judgeOutput.catalystTiming === 'CLOSE' ? 'CLOSE' : undefined,
    };

    const riskResult = computeRisk(riskInput);
    result.riskAction = riskResult.action;

    await db.decision.create({
      data: {
        marketId,
        candidateId: candidate?.id || null,
        action: riskResult.action,
        side: riskResult.side ?? null,
        reasonCode: riskResult.reasonCode ?? null,
        reason: riskResult.reason,
        judgeProbability: judgeOutput.trueProbability,
        impliedProb,
        edge: riskResult.edge,
        confidence: judgeOutput.confidence,
        uncertainty: judgeOutput.uncertainty,
        maxSize: riskResult.maxSize,
        urgency: riskResult.urgency,
        fees: riskResult.fees,
        slippage: riskResult.slippage,
        dryRun: isTestMode(),
      },
    });

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'DECIDED' },
      });
    }

    if (riskResult.action === 'BUY') {
      result.stages.push('EXECUTE');
      const orderSize = riskResult.adjustedSize || riskResult.maxSize;
      const orderPrice = riskResult.side === 'YES' ? impliedProb : 1 - impliedProb;

      if (isTestMode()) {
        await db.order.create({
          data: {
            marketId,
            venueOrderId: `PAPER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            side: riskResult.side ?? 'YES',
            price: orderPrice,
            size: orderSize,
            filledSize: orderSize,
            status: 'FILLED',
            submittedAt: new Date(),
            filledAt: new Date(),
          },
        });

        await db.position.create({
          data: {
            marketId,
            side: riskResult.side ?? 'YES',
            entryPrice: orderPrice,
            currentSize: orderSize,
            avgEntryPrice: orderPrice,
            unrealizedPnl: (judgeOutput.trueProbability - orderPrice) * orderSize,
            realizedPnl: 0,
            status: 'OPEN',
          },
        });

        result.orderId = `PAPER_${Date.now()}`;
      } else {
        await db.auditLog.create({
          data: {
            action: 'LIVE_ORDER_INTENT',
            entityType: 'Order',
            details: `Would place ${riskResult.side} order for ${riskResult.adjustedSize} on ${market.title}`,
          },
        });
      }

      if (candidate) {
        await db.tradeCandidate.update({
          where: { id: candidate.id },
          data: { stage: 'EXECUTED' },
        });
      }
    }

    try {
      await writeResearchToQdrant(marketId, market.title, researchContext, {
        judgeProbability: judgeOutput.trueProbability,
        confidence: judgeOutput.confidence,
        action: riskResult.action,
        side: riskResult.side,
        category: market.category,
      });
    } catch (e) {
      console.error('Qdrant writeback failed:', e);
    }

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Pipeline error';
    console.error(`[Pipeline] Error for market ${marketId}:`, error);
    return result;
  }
}