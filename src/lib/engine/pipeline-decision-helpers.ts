export type PipelineDecisionAction = 'BID' | 'WATCH' | 'SKIP';

export function shouldCreateExecutionJob(action: PipelineDecisionAction): boolean {
  return action === 'BID';
}

export function shouldCreateWatchlistEntry(action: PipelineDecisionAction): boolean {
  return action === 'WATCH';
}

export function buildWatchlistPayload(params: {
  marketId: string;
  decisionId: string;
  reason: string;
  targetPrice: number | null;
}) {
  return {
    marketId: params.marketId,
    decisionId: params.decisionId,
    reason: params.reason,
    targetPrice: params.targetPrice,
    status: 'ACTIVE',
  };
}
