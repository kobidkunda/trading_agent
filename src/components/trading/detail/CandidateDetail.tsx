'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface CandidateDetailProps {
  detail: {
    candidate: {
      id: string;
      marketId: string;
      stage: string;
      triageStatus: string | null;
      candidateScore: number | null;
      adjustedEdge: number | null;
      rawEdge: number | null;
      biasAdjustedProb: number | null;
      walletSignalScore: number | null;
      relatedMarketSignal: number | null;
      oracleRiskPenalty: number | null;
      correlationRiskPenalty: number | null;
      manipulationRiskPenalty: number | null;
      uncertaintyPenalty: number | null;
      contradictionPenalty: number | null;
      acceptedCriteria: string | null;
      rejectedCriteria: string | null;
      skipReason: string | null;
      cooldownUntil: string | null;
      nextEligibleAt: string | null;
      lastResearchAt: string | null;
      lastDecisionAt: string | null;
      lastExecutionAt: string | null;
    };
    market: {
      id: string;
      title: string;
      venue: string;
      category: string;
      status: string;
      latestPrice: number | null;
      latestSpread: number | null;
      latestLiquidity: number | null;
      resolutionTime: string | null;
    };
    orderbookSnapshots: Array<{
      id: string;
      capturedAt: string;
      spreadSource: string | null;
      bestBid: number | null;
      bestAsk: number | null;
      bidDepth: number | null;
      askDepth: number | null;
      fillProbability: number | null;
      thinBookDanger: boolean;
    }>;
    researchRuns: Array<{
      id: string;
      status: string;
      depth: string;
      createdAt: string;
      agentOutputs: Array<{ id: string }>;
      sources: Array<{ id: string }>;
    }>;
    decisions: Array<{
      id: string;
      action: string;
      edge: number | null;
      confidence: number | null;
      createdAt: string;
    }>;
    orders: Array<{
      id: string;
      lifecycleStatus: string;
      side: string;
      price: number | null;
      size: number;
      createdAt: string;
    }>;
    paperBets: Array<{
      id: string;
      stake: number;
      entryPrice: number;
      resolvedAt: string | null;
      pnl: number | null;
    }>;
    oracleCheck: {
      riskLevel: string | null;
      findingsJson: string | null;
    } | null;
    jobs: Array<{
      id: string;
      type: string;
      status: string;
      error: string | null;
      createdAt: string;
      researchCheckpoints: Array<{
        id: string;
        state: string;
        lastHeartbeatAt: string;
      }>;
    }>;
  };
}

function fmt(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function pct(value: number | null): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function CandidateDetail({ detail }: CandidateDetailProps) {
  const router = useRouter();
  const [queuing, setQueuing] = useState(false);

  const forceResearch = async () => {
    setQueuing(true);
    try {
      const response = await fetch(`/api/trading/candidates/${detail.candidate.id}/force-research`, { method: 'POST' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      toast.success('Force research queued');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to queue research');
    } finally {
      setQueuing(false);
    }
  };

  const latestBook = detail.orderbookSnapshots[0];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Badge variant="outline">{detail.candidate.stage}</Badge>
          {detail.candidate.triageStatus && <Badge variant="outline">{detail.candidate.triageStatus}</Badge>}
        </div>

        <Card className="border-gray-800 bg-gray-900">
          <CardHeader>
            <CardTitle className="text-lg">{detail.market.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div><p className="text-xs text-gray-500">Venue</p><p>{detail.market.venue}</p></div>
            <div><p className="text-xs text-gray-500">Category</p><p>{detail.market.category}</p></div>
            <div><p className="text-xs text-gray-500">Latest Price</p><p>{pct(detail.market.latestPrice)}</p></div>
            <div><p className="text-xs text-gray-500">Latest Spread</p><p>{pct(detail.market.latestSpread)}</p></div>
            <div className="md:col-span-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => router.push(`/market/${detail.market.id}`)}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Market Detail
              </Button>
              <Button size="sm" variant="outline" onClick={forceResearch} disabled={queuing}>
                {queuing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Force Research
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-800 bg-gray-900">
          <CardHeader><CardTitle className="text-sm">Score Breakdown</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div><p className="text-xs text-gray-500">Candidate Score</p><p>{detail.candidate.candidateScore?.toFixed(1) ?? '—'}</p></div>
            <div><p className="text-xs text-gray-500">Adjusted Edge</p><p>{pct(detail.candidate.adjustedEdge)}</p></div>
            <div><p className="text-xs text-gray-500">Bias Adj Prob</p><p>{pct(detail.candidate.biasAdjustedProb)}</p></div>
            <div><p className="text-xs text-gray-500">Wallet Signal</p><p>{detail.candidate.walletSignalScore?.toFixed(2) ?? '—'}</p></div>
            <div><p className="text-xs text-gray-500">Oracle Penalty</p><p>{detail.candidate.oracleRiskPenalty?.toFixed(2) ?? '—'}</p></div>
            <div><p className="text-xs text-gray-500">Correlation Penalty</p><p>{detail.candidate.correlationRiskPenalty?.toFixed(2) ?? '—'}</p></div>
            <div><p className="text-xs text-gray-500">Manipulation Penalty</p><p>{detail.candidate.manipulationRiskPenalty?.toFixed(2) ?? '—'}</p></div>
            <div><p className="text-xs text-gray-500">Uncertainty Penalty</p><p>{detail.candidate.uncertaintyPenalty?.toFixed(2) ?? '—'}</p></div>
            <div className="md:col-span-2"><p className="text-xs text-gray-500">Accepted Criteria</p><p className="text-sm">{detail.candidate.acceptedCriteria || '—'}</p></div>
            <div className="md:col-span-2"><p className="text-xs text-gray-500">Rejected Criteria</p><p className="text-sm">{detail.candidate.rejectedCriteria || '—'}</p></div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-gray-800 bg-gray-900">
            <CardHeader><CardTitle className="text-sm">Orderbook Snapshot</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!latestBook ? <p className="text-sm text-gray-500">No orderbook snapshot</p> : (
                <>
                  <p>Spread Source: {latestBook.spreadSource || '—'}</p>
                  <p>Best Bid / Ask: {pct(latestBook.bestBid)} / {pct(latestBook.bestAsk)}</p>
                  <p>Bid / Ask Depth: {latestBook.bidDepth ?? '—'} / {latestBook.askDepth ?? '—'}</p>
                  <p>Fill Probability: {pct(latestBook.fillProbability)}</p>
                  <p>Thin Book Danger: {latestBook.thinBookDanger ? 'Yes' : 'No'}</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900">
            <CardHeader><CardTitle className="text-sm">Oracle & Jobs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded border border-gray-800 p-3">
                <p className="text-xs text-gray-500">Oracle Risk</p>
                <p>{detail.oracleCheck?.riskLevel || '—'}</p>
              </div>
              {detail.jobs.map((job) => (
                <div key={job.id} className="rounded border border-gray-800 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{job.type}</Badge>
                    <Badge variant="outline">{job.status}</Badge>
                  </div>
                  {job.error && <p className="mt-2 text-xs text-red-400">{job.error}</p>}
                  {job.researchCheckpoints.map((checkpoint) => (
                    <p key={checkpoint.id} className="mt-2 text-xs text-gray-400">
                      {checkpoint.state} · {fmt(checkpoint.lastHeartbeatAt)}
                    </p>
                  ))}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-800 bg-gray-900">
          <CardHeader><CardTitle className="text-sm">Research History</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {detail.researchRuns.length === 0 ? <p className="text-sm text-gray-500">No research runs</p> : detail.researchRuns.map((run) => (
              <div key={run.id} className="flex items-center justify-between rounded border border-gray-800 px-3 py-2">
                <div>
                  <p className="text-sm">{run.depth} · {run.status}</p>
                  <p className="text-xs text-gray-500">{fmt(run.createdAt)}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => router.push(`/research-queue/${run.id}`)}>
                  Open
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-gray-800 bg-gray-900">
          <CardHeader><CardTitle className="text-sm">Decision / Execution</CardTitle></CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Decisions</p>
              {detail.decisions.map((decision) => (
                <div key={decision.id} className="rounded border border-gray-800 p-2 text-sm">
                  {decision.action} · {pct(decision.edge)} · {pct(decision.confidence)}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Orders</p>
              {detail.orders.map((order) => (
                <div key={order.id} className="rounded border border-gray-800 p-2 text-sm">
                  {order.lifecycleStatus} · {order.side} · {order.size}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Paper Bets</p>
              {detail.paperBets.map((bet) => (
                <div key={bet.id} className="rounded border border-gray-800 p-2 text-sm">
                  Stake {bet.stake} · Entry {bet.entryPrice} · PnL {bet.pnl ?? '—'}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
