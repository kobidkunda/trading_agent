// ── Simulation Engine ─────────────────────────────────────────────────────────
// Runs the full trading pipeline end-to-end in dry-run mode.
// Generates realistic mock markets, runs all agents, executes risk engine,
// and produces "would-be" orders — all without touching real money.
// ──────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { computeRisk } from '@/lib/engine/risk';
import { buildPaperOrderRecord, buildPaperPositionRecord, resolvePaperExecutionSize } from '@/lib/engine/paper-execution';
import { DEMO_MARKET_TEMPLATES } from '@/lib/engine/demo-mode';
import type {
  Venue,
  JudgeOutput,
  RiskEngineOutput,
  StrategySettings,
} from '@/lib/types';

// ── Agent Output Generators ─────────────────────────────────────────────────

function randRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(randRange(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateTriageOutput(title: string, category: string): {
  status: 'RELEVANT' | 'IRRELEVANT' | 'AMBIGUOUS';
  reason: string;
  worthResearch: boolean;
} {
  const relevant = Math.random() > 0.3;
  if (relevant) {
    const reasons = [
      `Market "${title}" has clear resolution criteria and falls within ${category} category`,
      `Sufficient liquidity and clear binary outcome makes this suitable for analysis`,
      `This market has an active trading community and good data availability for research`,
      `The resolution criteria are well-defined and the timeline is within our operational window`,
    ];
    return {
      status: 'RELEVANT',
      reason: pick(reasons),
      worthResearch: true,
    };
  }
  const reasons = [
    `Market "${title}" has ambiguous resolution criteria that may lead to disputes`,
    `Category ${category} is outside our core competency for reliable analysis`,
    `Insufficient historical data for similar markets to build reliable models`,
    `Resolution timeframe is too distant for accurate probability estimation`,
  ];
  return {
    status: pick(['IRRELEVANT', 'AMBIGUOUS'] as const),
    reason: pick(reasons),
    worthResearch: false,
  };
}

function generateBullOutput(title: string, impliedProb: number): {
  thesis: string;
  keyArguments: string[];
  supportingEvidence: string[];
  estimatedProbability: number;
  confidence: number;
} {
  const bullishShift = randRange(0.02, 0.15);
  return {
    thesis: `Multiple converging signals suggest the probability of "${title}" is currently underestimated by ${(bullishShift * 100).toFixed(1)} percentage points. Our analysis identifies at least three independent drivers that the market has not fully priced in.`,
    keyArguments: [
      `Historical precedent: Similar events in the past have resolved YES at ${randRange(55, 80).toFixed(0)}% rate, suggesting current implied probability of ${(impliedProb * 100).toFixed(1)}% is conservative`,
      `Information asymmetry: Recent developments not yet reflected in market pricing indicate a positive shift in underlying fundamentals`,
      `Expert consensus: Domain experts surveyed assign an average probability ${(bullishShift * 100 + impliedProb * 100).toFixed(1)}% — significantly above market price`,
      `Momentum indicators: Betting flow analysis shows consistent YES volume accumulation over the past ${randInt(3, 14)} days`,
    ].slice(0, randInt(2, 4)),
    supportingEvidence: [
      `Academic study published in 2025 found that 68% of comparable situations resolved favorably`,
      `Three independent forecasting platforms show probabilities ${(bullishShift * 100).toFixed(1)}-${(bullishShift * 100 + 5).toFixed(1)} percentage points higher`,
      `Recent regulatory or policy changes favor the YES outcome`,
      `Primary data source (official statistics) trend has been moving in the positive direction for ${randInt(2, 12)} consecutive periods`,
      `Market maker positioning suggests potential for a short squeeze on YES shares`,
    ].slice(0, randInt(2, 4)),
    estimatedProbability: Math.min(0.95, impliedProb + bullishShift),
    confidence: randRange(0.45, 0.85),
  };
}

function generateBearOutput(title: string, impliedProb: number): {
  thesis: string;
  keyArguments: string[];
  supportingEvidence: string[];
  estimatedProbability: number;
  confidence: number;
} {
  const bearishShift = randRange(0.03, 0.18);
  return {
    thesis: `Our contrarian analysis identifies several critical risk factors that suggest the probability of "${title}" is currently overestimated. The market appears to be pricing in favorable outcomes without adequate weight on tail risks.`,
    keyArguments: [
      `Base rate neglect: The historical base rate for this type of event is only ${(Math.max(0.1, impliedProb - bearishShift) * 100).toFixed(1)}% — significantly below the current market price`,
      `Overconfidence bias: Recent news coverage has created an availability cascade that inflates perceived probability`,
      `Structural headwinds: Macro-level constraints make the YES outcome materially harder than currently priced`,
      `Conservative resolution: Analysis of fine print in resolution criteria reveals additional hurdles not obvious at first glance`,
    ].slice(0, randInt(2, 4)),
    supportingEvidence: [
      `Metaculus and PredictionBook aggregates show mean estimates ${(bearishShift * 100).toFixed(1)} percentage points below market price`,
      `Conditional probability analysis: P(YES | current conditions) estimates at ${(Math.max(0.1, impliedProb - bearishShift) * 100).toFixed(1)}%`,
      `Similar markets with identical structural features resolved NO in ${randInt(55, 75)}% of cases`,
      `Key uncertainty events scheduled before resolution that could shift the outcome negatively`,
    ].slice(0, randInt(2, 4)),
    estimatedProbability: Math.max(0.05, impliedProb - bearishShift),
    confidence: randRange(0.4, 0.8),
  };
}

function generateContradictionOutput(bullThesis: string, bearThesis: string): {
  contradictions: string[];
  overlookedRisks: string[];
  alternativeInterpretations: string[];
  reliabilityAssessment: number;
} {
  return {
    contradictions: [
      `Both bull and bear analyses reference the same data source but reach opposite conclusions — suggesting the data is ambiguous rather than clearly supporting either side`,
      `The bull case assumes linear continuation of current trends, while historical data shows mean reversion is more common in this domain`,
      `Expert consensus cited in the bull case may suffer from herding behavior — the bear case provides better calibration against base rates`,
    ],
    overlookedRisks: [
      `Black swan potential: Neither analysis adequately accounts for low-probability, high-impact events that could completely shift the outcome`,
      `Selection bias: The evidence cited in both cases may suffer from publication bias — negative results are underrepresented in available sources`,
      `Temporal mismatch: Data from different time periods is combined without adjusting for structural changes in the underlying system`,
      `Correlation risk: This market may be correlated with other active positions, amplifying portfolio-level risk beyond what individual analysis suggests`,
    ],
    alternativeInterpretations: [
      `The resolution criteria may be interpreted differently by the market operator than assumed — this accounts for ${randRange(3, 8).toFixed(0)}% of uncertainty`,
      `Geopolitical factors could introduce non-linear discontinuities not captured by either analysis`,
      `The market may be partially efficient — current pricing could already reflect the information asymmetry claimed by the bull case`,
    ],
    reliabilityAssessment: randRange(0.4, 0.75),
  };
}

function generateJudgeOutput(
  title: string,
  impliedProb: number,
  bullOutput: ReturnType<typeof generateBullOutput>,
  bearOutput: ReturnType<typeof generateBearOutput>,
  contradictionOutput: ReturnType<typeof generateContradictionOutput>,
): JudgeOutput {
  // Weighted average with noise
  const bullWeight = bullOutput.confidence * contradictionOutput.reliabilityAssessment;
  const bearWeight = bearOutput.confidence * contradictionOutput.reliabilityAssessment;
  const totalWeight = bullWeight + bearWeight || 1;

  let trueProbability = (bullOutput.estimatedProbability * bullWeight + bearOutput.estimatedProbability * bearWeight) / totalWeight;
  trueProbability = Math.max(0.05, Math.min(0.95, trueProbability + randRange(-0.05, 0.05)));

  const confidence = randRange(0.35, 0.85);
  const uncertainty = randRange(0.1, 0.4);

  return {
    trueProbability: Math.round(trueProbability * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    uncertainty: Math.round(uncertainty * 1000) / 1000,
    uncertaintyPenalty: Math.round(uncertainty * 0.5 * 1000) / 1000,
    proEvidence: bullOutput.keyArguments.slice(0, 2),
    antiEvidence: bearOutput.keyArguments.slice(0, 2),
    sourceQuality: Math.round(randRange(0.5, 0.9) * 1000) / 1000,
    freshness: Math.round(randRange(0.6, 0.95) * 1000) / 1000,
    catalystTiming: pick(['NONE', 'NONE', 'NONE', 'FAR', 'CLOSE'] as const),
    skipReason: confidence < 0.4 ? 'Insufficient confidence in probability estimate' : undefined,
  };
}

// ── Simulation Types ─────────────────────────────────────────────────────────

export interface SimulationConfig {
  marketCount: number;
  venues: Venue[];
  categories: string[];
  strategy: StrategySettings;
  speed?: 'fast' | 'normal' | 'detailed';
}

export interface MarketSimResult {
  marketId: string;
  title: string;
  venue: Venue;
  category: string;
  impliedProb: number;
  liquidity: number;
  spread: number;
  triageResult: ReturnType<typeof generateTriageOutput>;
  bullOutput: ReturnType<typeof generateBullOutput> | null;
  bearOutput: ReturnType<typeof generateBearOutput> | null;
  contradictionOutput: ReturnType<typeof generateContradictionOutput> | null;
  judgeOutput: JudgeOutput | null;
  riskResult: RiskEngineOutput | null;
  simulatedOrder: {
    side: string;
    price: number;
    size: number;
    estimatedPnl: number;
  } | null;
  stage: 'SCANNED' | 'TRIAGED' | 'RESEARCHING' | 'JUDGED' | 'DECIDED' | 'EXECUTED';
  durationMs: number;
  error: string | null;
}

export interface SimulationReport {
  id: string;
  startedAt: string;
  completedAt: string;
  config: SimulationConfig;
  results: MarketSimResult[];
  summary: {
    totalMarkets: number;
    scanned: number;
    triagedRelevant: number;
    researched: number;
    judged: number;
    riskBid: number;
    riskWatch: number;
    riskSkip: number;
    executed: number;
    totalEstimatedPnl: number;
    totalExposure: number;
    avgConfidence: number;
    avgEdge: number;
    errors: number;
    totalDurationMs: number;
  };
}

// ── Main Simulation Runner ───────────────────────────────────────────────────

export async function runSimulation(config: SimulationConfig): Promise<SimulationReport> {
  const startTime = Date.now();
  const simulationId = `sim_${Date.now()}`;
  const results: MarketSimResult[] = [];

  // Filter and select market templates
  let templates = shuffle(DEMO_MARKET_TEMPLATES)
    .filter((t) => config.venues.includes(t.venue) || config.venues.length === 0)
    .filter((t) => config.categories.includes(t.category) || config.categories.length === 0);

  if (templates.length === 0) {
    templates = shuffle(DEMO_MARKET_TEMPLATES);
  }

  const selected = templates.slice(0, config.marketCount);

  // Process each market through the full pipeline
  for (const template of selected) {
    const marketStart = Date.now();

    try {
      const impliedProb = Math.round(randRange(...template.impliedProbRange) * 1000) / 1000;
      const liquidity = Math.round(randRange(...template.liquidityRange));
      const spread = Math.round(randRange(...template.spreadRange) * 1000) / 1000;

      // ── Step 1: Create Market in DB ──
      const market = await db.market.create({
        data: {
          externalId: `sim_${simulationId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          venue: template.venue,
          title: template.title,
          description: template.description,
          category: template.category,
          status: 'ACTIVE',
        },
      });

      // Create market snapshot
      await db.marketSnapshot.create({
        data: {
          marketId: market.id,
          impliedProb,
          liquidity,
          spread,
          volume24h: Math.round(liquidity * randRange(0.05, 0.3)),
          bestBid: impliedProb - spread / 2,
          bestAsk: impliedProb + spread / 2,
        },
      });

      // Create trade candidate
      const candidate = await db.tradeCandidate.create({
        data: {
          marketId: market.id,
          stage: 'SCANNED',
        },
      });

      // Create SCAN job
      await db.job.create({
        data: {
          type: 'SCAN',
          status: 'COMPLETED',
          priority: 5,
          payload: JSON.stringify({ marketId: market.id, marketTitle: template.title }),
          result: JSON.stringify({ marketId: market.id, impliedProb, liquidity, spread }),
          startedAt: new Date(marketStart),
          completedAt: new Date(marketStart + randInt(100, 500)),
        },
      });

      // ── Step 2: Triage ──
      const triageStart = Date.now();
      const triageResult = generateTriageOutput(template.title, template.category);

      await db.job.create({
        data: {
          type: 'TRIAGE',
          status: 'COMPLETED',
          priority: 7,
          payload: JSON.stringify({ marketId: market.id, marketTitle: template.title }),
          result: JSON.stringify(triageResult),
          startedAt: new Date(triageStart),
          completedAt: new Date(triageStart + randInt(200, 800)),
        },
      });

      // Update candidate
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: {
          stage: 'TRIAGED',
          triageStatus: triageResult.status,
          triageReason: triageResult.reason,
          researchQueued: triageResult.status === 'RELEVANT',
        },
      });

      // If irrelevant or ambiguous, skip research
      if (triageResult.status !== 'RELEVANT') {
        const result: MarketSimResult = {
          marketId: market.id,
          title: template.title,
          venue: template.venue,
          category: template.category,
          impliedProb,
          liquidity,
          spread,
          triageResult,
          bullOutput: null,
          bearOutput: null,
          contradictionOutput: null,
          judgeOutput: null,
          riskResult: null,
          simulatedOrder: null,
          stage: 'TRIAGED',
          durationMs: Date.now() - marketStart,
          error: null,
        };
        results.push(result);
        continue;
      }

      // ── Step 3: Research (Bull + Bear + Contradiction) ──
      const researchStart = Date.now();
      const researchRun = await db.researchRun.create({
        data: {
          marketId: market.id,
          candidateId: candidate.id,
          status: 'RUNNING',
          depth: 'DEEP',
          startedAt: new Date(researchStart),
        },
      });

      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'RESEARCHING' },
      });

      await db.job.create({
        data: {
          type: 'RESEARCH',
          status: 'COMPLETED',
          priority: 7,
          payload: JSON.stringify({ marketId: market.id, marketTitle: template.title, depth: 'DEEP' }),
          result: JSON.stringify({ researchRunId: researchRun.id, depth: 'DEEP' }),
          startedAt: new Date(researchStart),
          completedAt: new Date(researchStart + randInt(500, 2000)),
        },
      });

      // Generate research sources
      const sourceUrls = [
        `https://news.example.com/article/${Date.now()}`,
        `https://data.example.com/analysis/${template.category}`,
        `https://research.example.com/report/${template.venue.toLowerCase()}`,
      ];
      for (const url of sourceUrls) {
        await db.researchSource.create({
          data: {
            researchRunId: researchRun.id,
            url,
            title: `Research source for "${template.title}"`,
            content: `Analysis data for market: ${template.description}`,
            sourceType: pick(['SEARCH', 'CRAWL', 'SOCIAL'] as const),
            recencyScore: randRange(0.5, 0.95),
            qualityScore: randRange(0.4, 0.9),
          },
        });
      }

      // Generate bull output
      const bullOutput = generateBullOutput(template.title, impliedProb);
      await db.agentOutput.create({
        data: {
          researchRunId: researchRun.id,
          role: 'BULL',
          modelUsed: 'simulation-engine',
          promptVersion: String(config.strategy.promptVersion.bull ?? 1),
          output: JSON.stringify(bullOutput),
          tokenCount: randInt(800, 2000),
          latencyMs: randInt(500, 1500),
        },
      });

      // Generate bear output
      const bearOutput = generateBearOutput(template.title, impliedProb);
      await db.agentOutput.create({
        data: {
          researchRunId: researchRun.id,
          role: 'BEAR',
          modelUsed: 'simulation-engine',
          promptVersion: String(config.strategy.promptVersion.bear ?? 1),
          output: JSON.stringify(bearOutput),
          tokenCount: randInt(800, 2000),
          latencyMs: randInt(500, 1500),
        },
      });

      // Generate contradiction output
      const contradictionOutput = generateContradictionOutput(bullOutput.thesis, bearOutput.thesis);
      await db.agentOutput.create({
        data: {
          researchRunId: researchRun.id,
          role: 'CONTRADICTION',
          modelUsed: 'simulation-engine',
          promptVersion: String(config.strategy.promptVersion.contradiction ?? 1),
          output: JSON.stringify(contradictionOutput),
          tokenCount: randInt(600, 1500),
          latencyMs: randInt(400, 1200),
        },
      });

      // ── Step 4: Judge ──
      const judgeStart = Date.now();
      const judgeOutput = generateJudgeOutput(
        template.title,
        impliedProb,
        bullOutput,
        bearOutput,
        contradictionOutput,
      );

      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'JUDGED' },
      });

      await db.job.create({
        data: {
          type: 'JUDGE',
          status: 'COMPLETED',
          priority: 8,
          payload: JSON.stringify({ marketId: market.id, marketTitle: template.title }),
          result: JSON.stringify(judgeOutput),
          startedAt: new Date(judgeStart),
          completedAt: new Date(judgeStart + randInt(300, 1000)),
        },
      });

      await db.agentOutput.create({
        data: {
          researchRunId: researchRun.id,
          role: 'JUDGE',
          modelUsed: 'simulation-engine',
          promptVersion: String(config.strategy.promptVersion.judge ?? 1),
          output: JSON.stringify(judgeOutput),
          tokenCount: randInt(600, 1500),
          latencyMs: randInt(300, 900),
        },
      });

      // Mark ResearchRun as COMPLETED only after all agent outputs (including judge) are created
      await db.researchRun.update({
        where: { id: researchRun.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      // ── Step 5: Risk Engine (Deterministic) ──
      const riskStart = Date.now();

      // Check if judge says skip
      if (judgeOutput.skipReason) {
        const riskResult: RiskEngineOutput = {
          action: 'SKIP',
          maxSize: 0,
          adjustedSize: 0,
          urgency: 'LOW',
          reasonCode: 'LOW_CONFIDENCE',
          reason: judgeOutput.skipReason,
          edge: Math.abs(judgeOutput.trueProbability - impliedProb),
          fees: 0.02,
          slippage: 0.01,
        };

        await db.decision.create({
          data: {
            marketId: market.id,
            candidateId: candidate.id,
            action: 'SKIP',
            reasonCode: 'LOW_CONFIDENCE',
            reason: riskResult.reason,
            judgeProbability: judgeOutput.trueProbability,
            impliedProb,
            edge: riskResult.edge,
            confidence: judgeOutput.confidence,
            uncertainty: judgeOutput.uncertainty,
            maxSize: 0,
            urgency: 'LOW',
            fees: 0.02,
            slippage: 0.01,
            dryRun: true,
          },
        });

        await db.tradeCandidate.update({
          where: { id: candidate.id },
          data: { stage: 'DECIDED' },
        });

        await db.job.create({
          data: {
            type: 'RISK',
            status: 'COMPLETED',
            priority: 9,
            payload: JSON.stringify({ marketId: market.id, marketTitle: template.title }),
            result: JSON.stringify(riskResult),
            startedAt: new Date(riskStart),
            completedAt: new Date(riskStart + randInt(50, 200)),
          },
        });

        const result: MarketSimResult = {
          marketId: market.id,
          title: template.title,
          venue: template.venue,
          category: template.category,
          impliedProb,
          liquidity,
          spread,
          triageResult,
          bullOutput,
          bearOutput,
          contradictionOutput,
          judgeOutput,
          riskResult,
          simulatedOrder: null,
          stage: 'DECIDED',
          durationMs: Date.now() - marketStart,
          error: null,
        };
        results.push(result);
        continue;
      }

      // Run the real deterministic risk engine
      const riskEngineInput = {
        impliedProbability: impliedProb,
        judgeProbability: judgeOutput.trueProbability,
        confidence: judgeOutput.confidence,
        uncertainty: judgeOutput.uncertainty,
        fees: 0.02,
        slippage: 0.01,
        venue: template.venue,
        category: template.category,
        dailyExposure: randRange(0, 30000),
        categoryExposure: randRange(0, 8000),
        openPositions: randInt(0, 5),
        marketLiquidity: liquidity,
        marketSpread: spread,
        catalystTiming: judgeOutput.catalystTiming === 'CLOSE' ? 'CLOSE' : undefined,
      };

      const riskResult = computeRisk(riskEngineInput);

      // Create decision record
      await db.decision.create({
        data: {
          marketId: market.id,
          candidateId: candidate.id,
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
          dryRun: true,
        },
      });

      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'DECIDED' },
      });

      await db.job.create({
        data: {
          type: 'RISK',
          status: 'COMPLETED',
          priority: 9,
          payload: JSON.stringify({ marketId: market.id, marketTitle: template.title }),
          result: JSON.stringify(riskResult),
          startedAt: new Date(riskStart),
          completedAt: new Date(riskStart + randInt(50, 200)),
        },
      });

      // ── Step 6: Simulated Execution ──
      let simulatedOrder: { side: string; price: number; size: number; estimatedPnl: number } | null = null;
      if (riskResult.action === 'BID') {
        const execStart = Date.now();
        const orderSize = resolvePaperExecutionSize({
          adjustedSize: riskResult.adjustedSize,
          maxSize: riskResult.maxSize,
        });

        if (orderSize != null) {
          const orderPrice = riskResult.side === 'YES'
            ? impliedProb
            : 1 - impliedProb;
          const estimatedPnl = riskResult.side === 'YES'
            ? (judgeOutput.trueProbability - orderPrice) * orderSize
            : ((1 - judgeOutput.trueProbability) - orderPrice) * orderSize;
          const now = new Date(execStart);

          await db.order.create({
            data: buildPaperOrderRecord({
              marketId: market.id,
              venueOrderId: `DRY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              side: riskResult.side ?? 'YES',
              price: orderPrice,
              size: orderSize,
              now,
              dataSource: 'MOCK',
            }),
          });

          await db.position.create({
            data: buildPaperPositionRecord({
              marketId: market.id,
              side: riskResult.side ?? 'YES',
              entryPrice: orderPrice,
              currentSize: orderSize,
              judgeProbability: judgeOutput.trueProbability,
            }),
          });

          await db.tradeCandidate.update({
            where: { id: candidate.id },
            data: { stage: 'EXECUTED' },
          });

          await db.job.create({
            data: {
              type: 'EXECUTE',
              status: 'COMPLETED',
              priority: 10,
              payload: JSON.stringify({
                marketId: market.id,
                marketTitle: template.title,
                side: riskResult.side,
                size: orderSize,
                price: orderPrice,
              }),
              result: JSON.stringify({ status: 'SIMULATED_FILL', filledSize: orderSize }),
              startedAt: now,
              completedAt: new Date(execStart + randInt(100, 500)),
            },
          });

          simulatedOrder = {
            side: riskResult.side ?? 'YES',
            price: Math.round(orderPrice * 1000) / 1000,
            size: Math.round(orderSize * 100) / 100,
            estimatedPnl: Math.round(estimatedPnl * 100) / 100,
          };
        }
      }

      const result: MarketSimResult = {
        marketId: market.id,
        title: template.title,
        venue: template.venue,
        category: template.category,
        impliedProb,
        liquidity,
        spread,
        triageResult,
        bullOutput,
        bearOutput,
        contradictionOutput,
        judgeOutput,
        riskResult,
        simulatedOrder,
        stage: simulatedOrder ? 'EXECUTED' : 'DECIDED',
        durationMs: Date.now() - marketStart,
        error: null,
      };
      results.push(result);
    } catch (err) {
      results.push({
        marketId: '',
        title: template.title,
        venue: template.venue,
        category: template.category,
        impliedProb: 0,
        liquidity: 0,
        spread: 0,
        triageResult: { status: 'IRRELEVANT', reason: 'Error during simulation', worthResearch: false },
        bullOutput: null,
        bearOutput: null,
        contradictionOutput: null,
        judgeOutput: null,
        riskResult: null,
        simulatedOrder: null,
        stage: 'SCANNED',
        durationMs: Date.now() - marketStart,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Build summary
  const summary = {
    totalMarkets: results.length,
    scanned: results.filter((r) => r.stage >= 'SCANNED').length,
    triagedRelevant: results.filter((r) => r.triageResult.status === 'RELEVANT').length,
    researched: results.filter((r) => r.bullOutput !== null).length,
    judged: results.filter((r) => r.judgeOutput !== null).length,
    riskBid: results.filter((r) => r.riskResult?.action === 'BID').length,
    riskWatch: results.filter((r) => r.riskResult?.action === 'WATCH').length,
    riskSkip: results.filter((r) => r.riskResult?.action === 'SKIP').length,
    executed: results.filter((r) => r.simulatedOrder !== null).length,
    totalEstimatedPnl: results.reduce((s, r) => s + (r.simulatedOrder?.estimatedPnl ?? 0), 0),
    totalExposure: results.reduce((s, r) => s + (r.simulatedOrder?.size ?? 0), 0),
    avgConfidence: results.filter((r) => r.judgeOutput).length > 0
      ? results.filter((r) => r.judgeOutput).reduce((s, r) => s + (r.judgeOutput?.confidence ?? 0), 0) /
        results.filter((r) => r.judgeOutput).length
      : 0,
    avgEdge: results.filter((r) => r.riskResult).length > 0
      ? results.filter((r) => r.riskResult).reduce((s, r) => s + (r.riskResult?.edge ?? 0), 0) /
        results.filter((r) => r.riskResult).length
      : 0,
    errors: results.filter((r) => r.error).length,
    totalDurationMs: Date.now() - startTime,
  };

  return {
    id: simulationId,
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    config,
    results,
    summary,
  };
}
