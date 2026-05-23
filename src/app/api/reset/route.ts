import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const { confirm } = body as { confirm?: boolean };

    if (!confirm) {
      return NextResponse.json(
        { error: 'Provide { confirm: true } to confirm the reset' },
        { status: 400 }
      );
    }

    const errors: string[] = [];
    const cleared: string[] = [];

    const deleteOps: Array<{ name: string; fn: () => Promise<{ count: number }> }> = [
      { name: 'TradeCandidate', fn: () => db.tradeCandidate.deleteMany() },
      { name: 'CandidateRun', fn: () => db.candidateRun.deleteMany() },
      { name: 'ResearchRun', fn: () => db.researchRun.deleteMany() },
      { name: 'ResearchSource', fn: () => db.researchSource.deleteMany() },
      { name: 'ResearchCheckpoint', fn: () => db.researchCheckpoint.deleteMany() },
      { name: 'AgentOutput', fn: () => db.agentOutput.deleteMany() },
      { name: 'Decision', fn: () => db.decision.deleteMany() },
      { name: 'Fill', fn: () => db.fill.deleteMany() },
      { name: 'Order', fn: () => db.order.deleteMany() },
      { name: 'PaperBet', fn: () => db.paperBet.deleteMany() },
      { name: 'Position', fn: () => db.position.deleteMany() },
      { name: 'MarketSnapshot', fn: () => db.marketSnapshot.deleteMany() },
      { name: 'HistoricalSnapshot', fn: () => db.historicalSnapshot.deleteMany() },
      { name: 'Market', fn: () => db.market.deleteMany() },
      { name: 'Outcome', fn: () => db.outcome.deleteMany() },
      { name: 'Postmortem', fn: () => db.postmortem.deleteMany() },
      { name: 'ScanRun', fn: () => db.scanRun.deleteMany() },
      { name: 'VenueCursor', fn: () => db.venueCursor.deleteMany() },
      { name: 'Job', fn: () => db.job.deleteMany() },
      { name: 'WalletTrade', fn: () => db.walletTrade.deleteMany() },
      { name: 'Wallet', fn: () => db.wallet.deleteMany() },
      { name: 'WalletClusterSignal', fn: () => db.walletClusterSignal.deleteMany() },
      { name: 'ModelRegistryRecord', fn: () => db.modelRegistryRecord.deleteMany() },
      { name: 'EnsemblePrediction', fn: () => db.ensemblePrediction.deleteMany() },
      { name: 'BiasModelVersion', fn: () => db.biasModelVersion.deleteMany() },
      { name: 'CorrelationCluster', fn: () => db.correlationCluster.deleteMany() },
      { name: 'ClusterMarketLink', fn: () => db.clusterMarketLink.deleteMany() },
      { name: 'OracleCheck', fn: () => db.oracleCheck.deleteMany() },
      { name: 'CausalTreeNode', fn: () => db.causalTreeNode.deleteMany() },
      { name: 'RelatedMarket', fn: () => db.relatedMarket.deleteMany() },
      { name: 'StrategyConfigVersion', fn: () => db.strategyConfigVersion.deleteMany() },
      { name: 'BacktestRun', fn: () => db.backtestRun.deleteMany() },
      { name: 'OrderbookSnapshot', fn: () => db.orderbookSnapshot.deleteMany() },
      { name: 'Watchlist', fn: () => db.watchlist.deleteMany() },
      { name: 'AuditLog', fn: () => db.auditLog.deleteMany() },
    ];

    for (const { name, fn } of deleteOps) {
      try {
        const result = await fn();
        cleared.push(`${name}:${result.count}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${name}: ${msg}`);
      }
    }

    return NextResponse.json({ cleared, errors }, { status: 200 });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Reset failed: ${errorMsg}` }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  const preserved = ['Credential', 'PromptTemplate', 'Settings'];

  const countResults: Record<string, number> = {};
  const modelsToCount: Array<{ name: string; fn: () => Promise<number> }> = [
    { name: 'TradeCandidate', fn: () => db.tradeCandidate.count() },
    { name: 'CandidateRun', fn: () => db.candidateRun.count() },
    { name: 'ResearchRun', fn: () => db.researchRun.count() },
    { name: 'ResearchSource', fn: () => db.researchSource.count() },
    { name: 'ResearchCheckpoint', fn: () => db.researchCheckpoint.count() },
    { name: 'AgentOutput', fn: () => db.agentOutput.count() },
    { name: 'Decision', fn: () => db.decision.count() },
    { name: 'Fill', fn: () => db.fill.count() },
    { name: 'Order', fn: () => db.order.count() },
    { name: 'PaperBet', fn: () => db.paperBet.count() },
    { name: 'Position', fn: () => db.position.count() },
    { name: 'MarketSnapshot', fn: () => db.marketSnapshot.count() },
    { name: 'HistoricalSnapshot', fn: () => db.historicalSnapshot.count() },
    { name: 'Market', fn: () => db.market.count() },
    { name: 'Outcome', fn: () => db.outcome.count() },
    { name: 'Postmortem', fn: () => db.postmortem.count() },
    { name: 'ScanRun', fn: () => db.scanRun.count() },
    { name: 'VenueCursor', fn: () => db.venueCursor.count() },
    { name: 'Job', fn: () => db.job.count() },
    { name: 'WalletTrade', fn: () => db.walletTrade.count() },
    { name: 'Wallet', fn: () => db.wallet.count() },
    { name: 'WalletClusterSignal', fn: () => db.walletClusterSignal.count() },
    { name: 'ModelRegistryRecord', fn: () => db.modelRegistryRecord.count() },
    { name: 'EnsemblePrediction', fn: () => db.ensemblePrediction.count() },
    { name: 'BiasModelVersion', fn: () => db.biasModelVersion.count() },
    { name: 'CorrelationCluster', fn: () => db.correlationCluster.count() },
    { name: 'ClusterMarketLink', fn: () => db.clusterMarketLink.count() },
    { name: 'OracleCheck', fn: () => db.oracleCheck.count() },
    { name: 'CausalTreeNode', fn: () => db.causalTreeNode.count() },
    { name: 'RelatedMarket', fn: () => db.relatedMarket.count() },
    { name: 'StrategyConfigVersion', fn: () => db.strategyConfigVersion.count() },
    { name: 'BacktestRun', fn: () => db.backtestRun.count() },
    { name: 'OrderbookSnapshot', fn: () => db.orderbookSnapshot.count() },
    { name: 'Watchlist', fn: () => db.watchlist.count() },
    { name: 'AuditLog', fn: () => db.auditLog.count() },
  ];

  for (const { name, fn } of modelsToCount) {
    try {
      countResults[name] = await fn();
    } catch {
      countResults[name] = -1;
    }
  }

  return NextResponse.json({ counts: countResults, preserved }, { status: 200 });
}