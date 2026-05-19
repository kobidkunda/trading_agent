'use client';

import { useEffect, useState, useMemo, Fragment } from 'react';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginatedResponse, PaginationParams } from '@/lib/types';
import { useRouter } from 'next/navigation';
import {
  Search,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Filter,
  Clock,
  DollarSign,
  Radar,
  ArrowRight,
  Scale,
  Brain,
  Globe,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Timer,
  FileText,
  Star,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { Venue, TriageStatus, CandidateStage } from '@/lib/types';
import { VENUE_OPTIONS, STAGE_COLORS } from '@/lib/constants';
import { buildMarketTriageDetails } from '@/lib/engine/market-triage-view-model';
import { filterMarketsForMode } from '@/lib/engine/market-triage-mode-filter';
import { useTradingStore } from '@/store/trading-store';

// ── types ────────────────────────────────────────────────────────────────────

// Raw API response type (from /api/markets)
interface MarketApiRecord {
  id: string;
  title: string;
  externalId?: string;
  venue: string;
  description: string | null;
  category: string;
  status: string;
  dataSource?: 'MOCK' | 'REAL';
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  duplicateStatus?: string;
  reprocessReason?: string | null;
  lastDecisionAt?: string | null;
  resolutionTime: string | null;
  createdAt: string;
  updatedAt: string;
  snapshots: Array<{
    id: string;
    impliedProb: number;
    liquidity: number;
    spread: number;
    volume24h: number;
    bestBid: number | null;
    bestAsk: number | null;
    timestamp: string;
  }>;
  tradeCandidates: Array<{
    id: string;
    stage: string;
    triageStatus: string | null;
    triageReason: string | null;
    researchQueued: boolean;
    candidateScore?: number | null;
    nextEligibleAt?: string | null;
    reprocessReason?: string | null;
    lastDecisionAt?: string | null;
  }>
}

interface AgentOutput {
  id: string;
  role: string;
  modelUsed: string | null;
  promptVersion: string | null;
  output: string;
  tokenCount: number | null;
  latencyMs: number | null;
  createdAt: string;
}

interface ResearchSource {
  id: string;
  url: string;
  title: string | null;
  content: string | null;
  sourceType: string;
  recencyScore: number | null;
  qualityScore: number | null;
  extractedAt: string;
  provider?: string | null;
  reasonIncluded?: string | null;
  snippet?: string | null;
}

interface ResearchRunData {
  id: string;
  status: string;
  depth: string;
  startedAt: string | null;
  completedAt: string | null;
  sources: ResearchSource[];
  agentOutputs: AgentOutput[];
  transparencyStages?: TransparencyStageRecord[];
  sourceProvenance?: SourceProvenance[];
}

interface SourceProvenance {
  url: string;
  title: string | null;
  domain: string | null;
  sourceType: string;
  qualityScore: number | null;
  recencyScore: number | null;
  extractedAt: string;
}

interface TransparencySourceRef {
  title: string;
  url: string;
  domain: string | null;
  snippet: string | null;
  provider: string | null;
  reasonIncluded?: string | null;
}

interface TransparencyStageRecord {
  stage: string;
  serviceName: string;
  provider: string | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  status: 'running' | 'completed' | 'failed' | 'skipped' | 'timeout';
  failureReason: string | null;
  summary: string | null;
  rawOutput: string | null;
  sources: TransparencySourceRef[];
  references: TransparencySourceRef[];
}

interface DecisionData {
  id: string;
  action: string;
  side: string | null;
  reasonCode: string | null;
  reason: string | null;
  judgeProbability: number | null;
  impliedProb: number | null;
  edge: number | null;
  confidence: number | null;
  uncertainty: number | null;
  maxSize: number | null;
  urgency: string | null;
  dryRun: boolean;
  createdAt: string;
}

// Flattened row used by the UI
interface MarketRow {
  id: string;
  candidateId: string | null;
  title: string;
  externalId: string | null;
  venue: Venue;
  liquidity: number;
  spread: number;
  impliedProb: number;
  triageStatus: TriageStatus;
  triageReason: string;
  researchQueued: boolean;
  stage: CandidateStage;
  description: string;
  snapshotAt: string;
  snapshotAgeMinutes: number;
  category: string;
  dataSource: 'MOCK' | 'REAL';
  candidateScore: number | null;
  nextEligibleAt: string | null;
  duplicateStatus: string;
  lastSeenAt: string | null;
  firstSeenAt: string | null;
  reprocessReason: string | null;
  lastDecisionAt: string | null;
}

function flattenMarketRecord(m: MarketApiRecord): MarketRow {
  const snapshot = m.snapshots[0];
  const candidate = m.tradeCandidates[0];
  const details = buildMarketTriageDetails({
    snapshotAt: snapshot?.timestamp ?? m.updatedAt,
    now: new Date().toISOString(),
    externalId: m.externalId ?? null,
    dataSource: m.dataSource ?? 'REAL',
    candidateScore: candidate?.candidateScore ?? null,
    nextEligibleAt: candidate?.nextEligibleAt ?? null,
    duplicateStatus: (m.duplicateStatus as 'UNIQUE' | 'DUPLICATE' | 'COOLDOWN') ?? 'UNIQUE',
    lastSeenAt: m.lastSeenAt ?? null,
  });
  return {
    id: m.id,
    candidateId: candidate?.id ?? null,
    title: m.title,
    externalId: details.externalId,
    venue: m.venue as Venue,
    liquidity: snapshot?.liquidity ?? 0,
    spread: snapshot?.spread ?? 0,
    impliedProb: snapshot?.impliedProb ?? 0,
    triageStatus: (candidate?.triageStatus as TriageStatus) ?? 'IRRELEVANT',
    triageReason: candidate?.triageReason ?? '',
    researchQueued: candidate?.researchQueued ?? false,
    stage: (candidate?.stage as CandidateStage) ?? 'SCANNED',
    description: m.description ?? '',
    snapshotAt: snapshot?.timestamp ?? m.updatedAt,
    snapshotAgeMinutes: details.snapshotAgeMinutes,
    category: m.category,
    dataSource: details.dataSource,
    candidateScore: details.candidateScore,
    nextEligibleAt: details.nextEligibleAt,
    duplicateStatus: details.duplicateStatus,
    lastSeenAt: details.lastSeenAt,
    firstSeenAt: m.firstSeenAt ?? null,
    reprocessReason: m.reprocessReason ?? candidate?.reprocessReason ?? null,
    lastDecisionAt: m.lastDecisionAt ?? candidate?.lastDecisionAt ?? null,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function parseAgentOutput(output: string): Record<string, unknown> | null {
  try { return JSON.parse(output); } catch { return null; }
}

const ROLE_COLORS: Record<string, string> = {
  TRIAGE: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
  BULL: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  BEAR: 'text-red-400 border-red-500/30 bg-red-500/10',
  CONTRADICTION: 'text-amber-400 border-amber-500/50 bg-amber-500/20 shadow-sm shadow-amber-500/10',
  JUDGE: 'text-cyan-400 border-cyan-500/50 bg-cyan-500/20 shadow-sm shadow-cyan-500/10',
  DEERFLOW: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
};

const ROLE_ICONS: Record<string, React.ElementType> = {
  TRIAGE: Filter,
  BULL: ArrowRight,
  BEAR: ArrowRight,
  CONTRADICTION: AlertTriangle,
  JUDGE: Scale,
  DEERFLOW: Brain,
};

const STAGE_STATUS_ICONS: Record<string, React.ElementType> = {
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: Timer,
  timeout: Timer,
};

const STAGE_STATUS_COLORS: Record<string, string> = {
  running: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  completed: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  failed: 'text-red-400 border-red-500/30 bg-red-500/10',
  skipped: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  timeout: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
};

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Helper function to extract domain from URL
function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function InlineMarketDetail({
  market,
  onClose,
}: {
  market: MarketRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [forcingResearch, setForcingResearch] = useState(false);
  const [research, setResearch] = useState<ResearchRunData[]>([]);
  const [decisions, setDecisions] = useState<DecisionData[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function fetchData() {
      try {
        const [resRes, decRes] = await Promise.all([
          fetch(`/api/research?marketId=${market.id}`),
          fetch(`/api/decisions?marketId=${market.id}`),
        ]);
        if (!cancelled) {
          if (resRes.ok) {
            const data = await resRes.json();
            setResearch(data.researchRuns ?? []);
          }
          if (decRes.ok) {
            const data = await decRes.json();
            setDecisions(data.decisions ?? []);
          }
        }
      } catch {
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [market.id]);

  const latestResearch = research[0];
  const latestDecision = decisions[0];
  const agentOutputs = latestResearch?.agentOutputs ?? [];
  const sources = latestResearch?.sources ?? [];
  const provenance = latestResearch?.sourceProvenance ?? [];
  const transparencyStages = latestResearch?.transparencyStages ?? [];

  const sortedAgents = [...agentOutputs].sort((a, b) => {
    const order = ['TRIAGE', 'BULL', 'BEAR', 'CONTRADICTION', 'DEERFLOW', 'JUDGE'];
    return order.indexOf(a.role) - order.indexOf(b.role);
  });

  const sortedStages = [...transparencyStages].sort((a, b) => {
    const order = ['TRIAGE', 'BULL', 'BEAR', 'CONTRADICTION', 'DEERFLOW', 'JUDGE', 'NEWS_ANALYST', 'SENTIMENT_ANALYST', 'TECHNICAL_ANALYST', 'SYNTHESIS'];
    return order.indexOf(a.stage) - order.indexOf(b.stage);
  });

  const debateAgents = sortedAgents.filter(a => ['BULL', 'BEAR', 'CONTRADICTION', 'JUDGE'].includes(a.role));
  const hasDebate = debateAgents.length > 0;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-white">{market.title}</p>
          <div className="mt-1 flex items-center gap-2">
            {triageBadge(market.triageStatus)}
            {stageBadge(market.stage)}
            <span className="text-xs text-gray-600">{market.category}</span>
            {latestResearch && (
              <Badge className="text-[10px] border-blue-500/30 bg-blue-500/10 text-blue-400">
                {latestResearch.depth}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                setForcingResearch(true);
                if (!market.candidateId) {
                  toast.error('No candidate available for force research');
                  return;
                }

                const res = await fetch(`/api/trading/candidates/${market.candidateId}/force-research`, {
                  method: 'POST',
                });
                if (!res.ok) {
                  toast.error('Failed to queue force research');
                  return;
                }
                toast.success('Force research queued');
              } catch {
                toast.error('Failed to queue force research');
              } finally {
                setForcingResearch(false);
              }
            }}
            disabled={forcingResearch}
            className="h-6 text-[10px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
          >
            {forcingResearch ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Force Research
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => router.push(`/market/${market.id}`)}
            className="h-6 text-[10px] border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          >
            <FileText className="h-3 w-3 mr-1" />
            Full Detail
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-500 h-6 text-[10px]">
            Close
          </Button>
        </div>
      </div>
        {market.description && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">Description</p>
            <p className="text-sm leading-relaxed text-gray-300">{market.description}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500"><DollarSign className="mr-1 inline h-3 w-3" />Liquidity</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{formatCurrency(market.liquidity)}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Spread</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{(market.spread * 100).toFixed(2)}%</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Implied Probability</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{(market.impliedProb * 100).toFixed(1)}%</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500"><Clock className="mr-1 inline h-3 w-3" />Last Snapshot</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{new Date(market.snapshotAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">External ID</p>
            <p className="mt-1 text-xs font-bold text-gray-200 break-all">{market.externalId ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Snapshot Age</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{market.snapshotAgeMinutes}m</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Candidate Score</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{market.candidateScore ?? '—'}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Data Source</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{market.dataSource}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Duplicate Status</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{market.duplicateStatus}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Next Eligible</p>
            <p className="mt-1 text-xs font-bold text-gray-200">{market.nextEligibleAt ? new Date(market.nextEligibleAt).toLocaleString() : '—'}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Last Seen</p>
            <p className="mt-1 text-xs font-bold text-gray-200">{market.lastSeenAt ? new Date(market.lastSeenAt).toLocaleString() : '—'}</p>
          </div>
        </div>

        {market.triageReason && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">Triage Reason</p>
            <p className="text-sm text-gray-400">{market.triageReason}</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
            <span className="ml-2 text-sm text-gray-500">Loading pipeline results...</span>
          </div>
        )}

        {!loading && latestDecision && (
          <div className="rounded-lg border border-gray-700 bg-gray-800/30 p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Decision</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[10px] text-gray-500">Action</p>
                <p className={cn('text-sm font-bold',
                  latestDecision.action === 'BID' ? 'text-emerald-400' :
                  latestDecision.action === 'WATCH' ? 'text-amber-400' :
                  'text-red-400'
                )}>
                  {latestDecision.action}
                  {latestDecision.side ? ` ${latestDecision.side}` : ''}
                </p>
              </div>
              {latestDecision.edge !== null && (
                <div>
                  <p className="text-[10px] text-gray-500">Edge</p>
                  <p className="text-sm font-bold text-gray-200">{((latestDecision.edge ?? 0) * 100).toFixed(2)}%</p>
                </div>
              )}
              {latestDecision.judgeProbability !== null && (
                <div>
                  <p className="text-[10px] text-gray-500">Judge Prob</p>
                  <p className="text-sm font-bold text-cyan-400">{((latestDecision.judgeProbability ?? 0) * 100).toFixed(1)}%</p>
                </div>
              )}
              {latestDecision.confidence !== null && (
                <div>
                  <p className="text-[10px] text-gray-500">Confidence</p>
                  <p className="text-sm font-bold text-gray-200">{((latestDecision.confidence ?? 0) * 100).toFixed(0)}%</p>
                </div>
              )}
            </div>
            {latestDecision.reason && (
              <p className="mt-2 text-xs text-gray-500">{latestDecision.reasonCode ? `[${latestDecision.reasonCode}] ` : ''}{latestDecision.reason}</p>
            )}
          </div>
        )}

        {/* Stage Transparency Section */}
        {!loading && sortedStages.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Stage Transparency</h4>
            <div className="space-y-2">
              {sortedStages.map((stage, stageIndex) => {
                const isExpanded = expandedStage === `${stage.stage}-${stage.serviceName}-${stageIndex}`;
                const statusColor = STAGE_STATUS_COLORS[stage.status] ?? STAGE_STATUS_COLORS.completed;
                const StatusIcon = STAGE_STATUS_ICONS[stage.status] ?? CheckCircle2;
                const isDebateStage = ['BULL', 'BEAR', 'CONTRADICTION', 'JUDGE'].includes(stage.stage);

                return (
                  <div key={`${stage.stage}-${stage.serviceName}-${stageIndex}`} className={cn(
                    "rounded-lg border bg-gray-800/20",
                    isDebateStage ? "border-amber-500/30" : "border-gray-800"
                  )}>
                    <button
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-800/50"
                      onClick={() => setExpandedStage(isExpanded ? null : `${stage.stage}-${stage.serviceName}-${stageIndex}`)}
                    >
                      <div className="flex items-center gap-2">
                        <StatusIcon className={cn("h-3.5 w-3.5", stage.status === 'running' && "animate-spin")} />
                        <Badge className={cn('text-[10px]', statusColor)}>{stage.status}</Badge>
                        <span className={cn("text-sm font-medium", isDebateStage && "text-amber-400")}>
                          {stage.stage}
                        </span>
                        {isDebateStage && <AlertTriangle className="h-3 w-3 text-amber-400" />}
                      </div>
                      <div className="flex items-center gap-2">
                        {stage.durationMs !== null && (
                          <span className="text-[10px] text-gray-600">{formatDuration(stage.durationMs)}</span>
                        )}
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-500" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-600" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-800 px-3 py-2 space-y-2">
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <span className="text-gray-500">Service:</span>{' '}
                            <span className="text-gray-300">{stage.serviceName}</span>
                          </div>
                          {stage.provider && (
                            <div>
                              <span className="text-gray-500">Provider:</span>{' '}
                              <span className="text-gray-300">{stage.provider}</span>
                            </div>
                          )}
                          {stage.model && (
                            <div>
                              <span className="text-gray-500">Model:</span>{' '}
                              <span className="text-gray-300">{stage.model}</span>
                            </div>
                          )}
                          {stage.startedAt && (
                            <div>
                              <span className="text-gray-500">Started:</span>{' '}
                              <span className="text-gray-300">{new Date(stage.startedAt).toLocaleTimeString()}</span>
                            </div>
                          )}
                        </div>
                        {stage.failureReason && (
                          <div className="rounded bg-red-500/10 border border-red-500/20 p-2">
                            <p className="text-[10px] text-red-400 font-medium">Failure Reason</p>
                            <p className="text-xs text-red-300">{stage.failureReason}</p>
                          </div>
                        )}
                        {stage.summary && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">Summary</p>
                            <p className="text-xs text-gray-300">{stage.summary}</p>
                          </div>
                        )}
                        {stage.rawOutput && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">Raw Output</p>
                            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px] text-gray-400 bg-gray-900/50 p-2 rounded">{stage.rawOutput}</pre>
                          </div>
                        )}
                        {/* Sources (with full provenance) */}
                        {stage.sources?.length > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">Sources ({stage.sources.length})</p>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {stage.sources.slice(0, 5).map((src, idx) => (
                                <div key={idx} className="flex items-start gap-2 text-[10px]">
                                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-gray-600" />
                                  <div className="min-w-0">
                                    <a
                                      href={src.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-cyan-400 hover:underline truncate block"
                                    >
                                      {src.title || src.url}
                                    </a>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      {src.domain && <span className="text-gray-600">{src.domain}</span>}
                                      {src.provider && (
                                        <Badge variant="outline" className="text-[9px] border-gray-700 bg-gray-800 text-gray-400">
                                          {src.provider}
                                        </Badge>
                                      )}
                                    </div>
                                    {src.snippet && <p className="text-gray-500 line-clamp-2">{src.snippet}</p>}
                                    {src.reasonIncluded && (
                                      <p className="text-gray-500 italic">{src.reasonIncluded}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {stage.sources.length > 5 && (
                                <p className="text-[10px] text-gray-600 text-center">+ {stage.sources.length - 5} more</p>
                              )}
                            </div>
                          </div>
                        )}
                        {/* References (legacy format) */}
                        {stage.references?.length > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">References ({stage.references.length})</p>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {stage.references.slice(0, 5).map((ref, idx) => (
                                <div key={idx} className="flex items-start gap-2 text-[10px]">
                                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-gray-600" />
                                  <div className="min-w-0">
                                    <a
                                      href={ref.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-cyan-400 hover:underline truncate block"
                                    >
                                      {ref.title || ref.url}
                                    </a>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      {ref.domain && <span className="text-gray-600">{ref.domain}</span>}
                                      {ref.provider && (
                                        <Badge variant="outline" className="text-[9px] border-gray-700 bg-gray-800 text-gray-400">
                                          {ref.provider}
                                        </Badge>
                                      )}
                                    </div>
                                    {ref.snippet && <p className="text-gray-500 line-clamp-2">{ref.snippet}</p>}
                                    {ref.reasonIncluded && (
                                      <p className="text-gray-500 italic">{ref.reasonIncluded}</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                              {stage.references.length > 5 && (
                                <p className="text-[10px] text-gray-600 text-center">+ {stage.references.length - 5} more</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Debate and Judge Section - Emphasized */}
        {!loading && hasDebate && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Debate and Judge Analysis
            </h4>
            <div className="space-y-2">
              {debateAgents.map((agent) => {
                const parsed = parseAgentOutput(agent.output);
                const isExpanded = expandedAgent === agent.id;
                const roleColor = ROLE_COLORS[agent.role] ?? 'text-gray-400 border-gray-500/30 bg-gray-500/10';
                const RoleIcon = ROLE_ICONS[agent.role] ?? ArrowRight;
                const isJudge = agent.role === 'JUDGE';
                const isContradiction = agent.role === 'CONTRADICTION';

                return (
                  <div key={agent.id} className={cn(
                    "rounded-lg border bg-gray-800/40",
                    (isJudge || isContradiction) ? "border-cyan-500/40 shadow-sm shadow-cyan-500/5" : "border-gray-800"
                  )}>
                    <button
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-800/60"
                      onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                    >
                      <div className="flex items-center gap-2">
                        <RoleIcon className={cn("h-3.5 w-3.5", (isJudge || isContradiction) && "text-amber-400")} />
                        <Badge className={cn('text-[10px]', roleColor)}>{agent.role}</Badge>
                        {isJudge && <span className="text-[10px] text-cyan-400 font-medium">Final Verdict</span>}
                        {isContradiction && <span className="text-[10px] text-amber-400 font-medium">Debate</span>}
                        {agent.modelUsed && <span className="text-[10px] text-gray-600">{agent.modelUsed}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {agent.latencyMs != null && <span className="text-[10px] text-gray-600">{agent.latencyMs}ms</span>}
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-500" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-600" />}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-gray-800 px-3 py-2 space-y-2">
                        {parsed ? (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">Structured Output</p>
                            <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-gray-300 bg-gray-900/50 p-2 rounded">{JSON.stringify(parsed, null, 2)}</pre>
                          </div>
                        ) : (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">Raw Output</p>
                            <p className="text-xs text-gray-400 whitespace-pre-wrap">{agent.output}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Agent Pipeline Section - Other Agents */}
        {!loading && sortedAgents.filter(a => !['BULL', 'BEAR', 'CONTRADICTION', 'JUDGE'].includes(a.role)).length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Agent Pipeline</h4>
            <div className="space-y-2">
              {sortedAgents.filter(a => !['BULL', 'BEAR', 'CONTRADICTION', 'JUDGE'].includes(a.role)).map((agent) => {
                const parsed = parseAgentOutput(agent.output);
                const isExpanded = expandedAgent === agent.id;
                const roleColor = ROLE_COLORS[agent.role] ?? 'text-gray-400 border-gray-500/30 bg-gray-500/10';
                const RoleIcon = ROLE_ICONS[agent.role] ?? ArrowRight;
                return (
                  <div key={agent.id} className="rounded-lg border border-gray-800 bg-gray-800/20">
                    <button
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-800/50"
                      onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                    >
                      <div className="flex items-center gap-2">
                        <RoleIcon className="h-3.5 w-3.5" />
                        <Badge className={cn('text-[10px]', roleColor)}>{agent.role}</Badge>
                        {agent.modelUsed && <span className="text-[10px] text-gray-600">{agent.modelUsed}</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {agent.latencyMs != null && <span className="text-[10px] text-gray-600">{agent.latencyMs}ms</span>}
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-gray-500" /> : <ChevronRight className="h-3.5 w-3.5 text-gray-600" />}
                      </div>
                    </button>
                    {isExpanded && parsed && (
                      <div className="border-t border-gray-800 px-3 py-2">
                        <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap text-xs text-gray-300">{JSON.stringify(parsed, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Research Sources with Provenance */}
        {!loading && (provenance.length > 0 || sources.length > 0) && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Research Sources ({provenance.length || sources.length})
            </h4>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {(provenance.length > 0 ? provenance : sources.map(s => ({
                url: s.url,
                title: s.title,
                domain: null,
                sourceType: s.sourceType,
                qualityScore: s.qualityScore,
                recencyScore: s.recencyScore,
                extractedAt: s.extractedAt,
                provider: s.provider ?? null,
                reasonIncluded: s.reasonIncluded ?? null,
                snippet: s.snippet ?? null,
              }))).map((src, idx) => {
                const sourceId = `src-${idx}`;
                const isExpanded = expandedSource === sourceId;
                const domain = src.domain || extractDomain(src.url);

                return (
                  <div key={sourceId} className="rounded-lg border border-gray-800 bg-gray-800/30 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-cyan-400 underline-offset-2 hover:underline truncate block"
                        >
                          {src.title || src.url}
                        </a>
                        <div className="flex items-center gap-2 mt-1">
                          {domain && (
                            <Badge variant="outline" className="text-[10px] border-gray-700 bg-gray-800 text-gray-400 flex items-center gap-1">
                              <Globe className="h-3 w-3" />
                              {domain}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px] border-gray-700 bg-gray-800 text-gray-400">
                            {src.sourceType}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-gray-500"
                        onClick={() => setExpandedSource(isExpanded ? null : sourceId)}
                      >
                        {isExpanded ? 'Less' : 'More'}
                      </Button>
                    </div>
                    {'content' in src && (src as { content?: string }).content && (
                      <p className="mt-2 text-xs text-gray-500 line-clamp-2">{(src as { content?: string }).content}</p>
                    )}
                    {'snippet' in src && (src as { snippet?: string }).snippet && (
                      <p className="mt-2 text-xs text-gray-500 line-clamp-2">{(src as { snippet?: string }).snippet}</p>
                    )}
                    {isExpanded && (
                      <div className="mt-2 pt-2 border-t border-gray-800 space-y-1 text-[10px] text-gray-500">
                        <div className="flex items-center gap-2">
                          <ExternalLink className="h-3 w-3" />
                          <a href={src.url} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline truncate">
                            {src.url}
                          </a>
                        </div>
                        {src.qualityScore !== null && (
                          <p>Quality Score: {(src.qualityScore * 100).toFixed(0)}%</p>
                        )}
                        {src.recencyScore !== null && (
                          <p>Recency Score: {(src.recencyScore * 100).toFixed(0)}%</p>
                        )}
                        {'provider' in src && (src as { provider?: string }).provider && (
                          <p>Provider: <span className="text-gray-400">{(src as { provider?: string }).provider}</span></p>
                        )}
                        {'reasonIncluded' in src && (src as { reasonIncluded?: string }).reasonIncluded && (
                          <p>Reason: <span className="text-gray-400 italic">{(src as { reasonIncluded?: string }).reasonIncluded}</span></p>
                        )}
                        <p>Extracted: {new Date(src.extractedAt).toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && !latestResearch && !latestDecision && (
          <div className="rounded-lg border border-gray-800 bg-gray-800/20 p-4 text-center">
            <p className="text-sm text-gray-500">No pipeline results yet</p>
            <p className="mt-1 text-xs text-gray-600">This market has not been processed through the research pipeline</p>
          </div>
        )}
    </div>
  );
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function triageBadge(status: TriageStatus) {
  const styles: Record<TriageStatus, string> = {
    RELEVANT: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    IRRELEVANT: 'border-gray-500/30 bg-gray-500/10 text-gray-500',
    AMBIGUOUS: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  };
  return (
    <Badge className={cn('text-[10px]', styles[status])}>{status}</Badge>
  );
}

function stageBadge(stage: CandidateStage) {
  return (
    <Badge className="gap-1 text-[10px]">
      <span
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          STAGE_COLORS[stage] ?? 'bg-gray-500'
        )}
      />
      {stage}
    </Badge>
  );
}

function venueLabel(v: Venue): string {
  return VENUE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

function venueColor(v: Venue): string {
  return VENUE_OPTIONS.find((o) => o.value === v)?.color ?? '#888';
}

// ── component ────────────────────────────────────────────────────────────────

type PriorityFilter = 'aplus' | 'new' | 'changed' | 'all';

const PRIORITY_CONFIG: Record<PriorityFilter, { label: string; icon: React.ElementType; params: string }> = {
  aplus: { label: '⭐ A+', icon: Star, params: 'onlyAPlus=true&sortPriority=score' },
  new: { label: '🆕 New', icon: Sparkles, params: 'onlyNew=true&sortBy=firstSeen' },
  changed: { label: '🔄 Changed', icon: RotateCcw, params: 'onlyChanged=true&sortBy=updatedAt' },
  all: { label: 'All', icon: Filter, params: 'sortBy=updatedAt' },
};

export function MarketTriage() {
  const { tradingMode } = useTradingStore();
  const [search, setSearch] = useState('');
  const [venueFilter, setVenueFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('aplus');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const {
    data: markets,
    page,
    limit,
    total,
    totalPages,
    loading,
    setPage,
    setLimit,
    fetchData,
  } = usePagination<MarketRow>(
    async (params: PaginationParams): Promise<PaginatedResponse<MarketRow>> => {
      const query = new URLSearchParams(PRIORITY_CONFIG[priorityFilter].params);
      query.set('page', String(params.page));
      query.set('limit', String(params.limit));
      if (search.trim()) query.set('search', search.trim());
      if (venueFilter !== 'ALL') query.set('venue', venueFilter);
      if (statusFilter !== 'ALL') query.set('status', statusFilter);
      const res = await fetch(`/api/markets?${query}`);
      if (!res.ok) throw new Error('Failed to fetch markets');
      const data = await res.json();
      const rows = (data.data ?? []).map(flattenMarketRecord);
      return { ...data, data: filterMarketsForMode(rows, tradingMode) };
    },
    [search, venueFilter, statusFilter, priorityFilter, tradingMode],
    { defaultSortBy: PRIORITY_CONFIG[priorityFilter].params.includes('sortPriority=score') ? 'candidateScore' : 'updatedAt', defaultSortOrder: 'desc' },
  );

  const summaryStats = useMemo(() => ({
    total,
    relevant: markets.filter((m) => m.triageStatus === 'RELEVANT').length,
    queued: markets.filter((m) => m.researchQueued).length,
    totalLiq: markets.reduce((s, m) => s + m.liquidity, 0),
  }), [markets, total]);

  if (loading && markets.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Market Triage</h2>
        <div className="h-64 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Market Triage</h2>
          <p className="mt-1 text-sm text-gray-500">
            Live market scanning and triage pipeline
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
          onClick={() => fetchData()}
          disabled={loading}
        >
          <RefreshCw
            className={cn('h-4 w-4', loading && 'animate-spin')}
          />
          Refresh
        </Button>
      </div>

      {/* Empty state when no markets at all */}
      {markets.length === 0 ? (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <Radar className="h-7 w-7 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-400">
              No markets scanned yet
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Start a market scan to populate this view.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              {
                label: 'Total Markets',
                value: summaryStats.total,
                color: 'text-white',
              },
              {
                label: 'Relevant',
                value: summaryStats.relevant,
                color: 'text-emerald-400',
              },
              {
                label: 'Research Queued',
                value: summaryStats.queued,
                color: 'text-amber-400',
              },
              {
                label: 'Total Liquidity',
                value: formatCurrency(summaryStats.totalLiq),
                color: 'text-cyan-400',
              },
            ].map((s) => (
              <Card
                key={s.label}
                className="border-gray-800 bg-gray-900"
              >
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={cn('mt-1 text-xl font-bold', s.color)}>
                    {s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Priority filter chips */}
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  View
                </span>
                {(Object.keys(PRIORITY_CONFIG) as PriorityFilter[]).map((key) => {
                  const cfg = PRIORITY_CONFIG[key];
                  const Icon = cfg.icon;
                  const active = priorityFilter === key;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setPriorityFilter(key);
                      }}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                        active
                          ? 'bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 shadow-sm shadow-emerald-500/10'
                          : 'border border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300',
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Filters */}
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <Input
                    placeholder="Search markets..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="border-gray-700 bg-gray-800 pl-9 text-white placeholder:text-gray-600"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-500" />
                  <Select value={venueFilter} onValueChange={setVenueFilter}>
                    <SelectTrigger className="w-36 border-gray-700 bg-gray-800 text-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-gray-700 bg-gray-900">
                      <SelectItem value="ALL">All Venues</SelectItem>
                      {VENUE_OPTIONS.map((v) => (
                        <SelectItem key={v.value} value={v.value}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-36 border-gray-700 bg-gray-800 text-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-gray-700 bg-gray-900">
                      <SelectItem value="ALL">All Status</SelectItem>
                      <SelectItem value="RELEVANT">Relevant</SelectItem>
                      <SelectItem value="IRRELEVANT">Irrelevant</SelectItem>
                      <SelectItem value="AMBIGUOUS">Ambiguous</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Data Table */}
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="p-0">
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="w-8" />
                      <TableHead className="text-gray-500">Market</TableHead>
                      <TableHead className="text-gray-500">Venue</TableHead>
                      <TableHead className="text-right text-gray-500">
                        Liquidity
                      </TableHead>
                      <TableHead className="text-right text-gray-500">
                        Spread
                      </TableHead>
                      <TableHead className="text-right text-gray-500">
                        Imp. Prob
                      </TableHead>
                      <TableHead className="text-gray-500">Meta</TableHead>
                      <TableHead className="text-gray-500">Triage</TableHead>
                      <TableHead className="text-gray-500">Stage</TableHead>
                      <TableHead className="text-gray-500">Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {markets.length === 0 ? (
                      <TableRow className="border-gray-800">
                        <TableCell
                          colSpan={10}
                          className="py-8 text-center text-sm text-gray-600"
                        >
                          No markets match the current filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      markets.map((m) => (
                        <Fragment key={m.id}>
                          <TableRow
                            key={m.id}
                            className="cursor-pointer border-gray-800 transition-colors hover:bg-gray-800/50"
                            onClick={() =>
                              setExpandedId(expandedId === m.id ? null : m.id)
                            }
                          >
                            <TableCell className="w-8 px-3">
                              {expandedId === m.id ? (
                                <ChevronDown className="h-4 w-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-gray-600" />
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="max-w-xs">
                                <p className="truncate text-sm font-medium text-gray-200">
                                  {m.title}
                                </p>
                                <div className="flex items-center gap-2">
                                  {m.researchQueued && (
                                    <span className="text-[10px] text-amber-400">
                                      ⏳ Research
                                    </span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span
                                className="text-xs font-medium"
                                style={{ color: venueColor(m.venue) }}
                              >
                                {venueLabel(m.venue)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm tabular-nums text-gray-300">
                                {formatCurrency(m.liquidity)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span
                                className={cn(
                                  'text-sm tabular-nums',
                                  m.spread > 0.04
                                    ? 'text-red-400'
                                    : m.spread > 0.02
                                      ? 'text-amber-400'
                                      : 'text-emerald-400'
                                )}
                              >
                                {(m.spread * 100).toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm tabular-nums text-gray-300">
                                {(m.impliedProb * 100).toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1 text-[10px] text-gray-400">
                                <p>ID: {m.externalId ?? '—'}</p>
                                {m.firstSeenAt && (
                                  <p>1st: {new Date(m.firstSeenAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                                )}
                                {m.lastDecisionAt && (
                                  <p>Dec: {new Date(m.lastDecisionAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                                )}
                                <p>Score: {m.candidateScore ?? '—'}</p>
                                <p>Src: {m.dataSource}</p>
                              </div>
                            </TableCell>
                            <TableCell>{triageBadge(m.triageStatus)}</TableCell>
                            <TableCell>{stageBadge(m.stage)}</TableCell>
                            <TableCell>
                              {m.reprocessReason ? (
                                <Badge className="text-[9px] border-amber-500/30 bg-amber-500/10 text-amber-400 max-w-24 truncate" title={m.reprocessReason}>
                                  {m.reprocessReason}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-gray-700">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                          {expandedId === m.id && (
                            <TableRow key={`${m.id}-detail`} className="border-gray-800 bg-gray-900/80">
                              <TableCell colSpan={10} className="p-0">
                                <InlineMarketDetail market={m} onClose={() => setExpandedId(null)} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="py-2">
            <PaginationBar
              page={page}
              totalPages={totalPages || 1}
              limit={limit}
              onPageChange={setPage}
              onLimitChange={setLimit}
            />
          </div>

        </>
      )}
    </div>
  );
}
