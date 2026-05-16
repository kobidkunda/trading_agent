export function summarizePipelineObservability(params: {
  scanRuns: Array<{ id: string }>;
  candidates: Array<{ id: string }>;
  watchlist: Array<{ id: string }>;
  openOrders: Array<{ id: string }>;
}) {
  return {
    scanRunsCount: params.scanRuns.length,
    candidatesCount: params.candidates.length,
    watchlistCount: params.watchlist.length,
    openOrdersCount: params.openOrders.length,
  };
}

export function hasPipelineData(params: {
  scanRuns: Array<{ id: string }>;
  candidates: Array<{ id: string }>;
  watchlist: Array<{ id: string }>;
  openOrders: Array<{ id: string }>;
}) {
  return params.scanRuns.length > 0 || params.candidates.length > 0 || params.watchlist.length > 0 || params.openOrders.length > 0;
}
