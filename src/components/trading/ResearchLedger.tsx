'use client';

import { useEffect, useState, useMemo, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  ClipboardList,
  Clock,
  Loader2,
  Filter,
  Scale,
  ArrowRight,
  Brain,
  BookOpen,
  Eye,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  SkipForward,
  ExternalLink,
  Activity,
  FileText,
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
import type { Venue, TransparencyStageRecord, TransparencySourceRef } from '@/lib/types';
import { VENUE_OPTIONS, REASON_CODE_DESCRIPTIONS } from '@/lib/constants';

// ── types ────────────────────────────────────────────────────────────────────

interface DecisionApiRecord {
  id: string;
  marketId: string;
  candidateId: string | null;
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
  fees: number | null;
  slippage: number | null;
  dryRun: boolean;
  createdAt: string;
  market: { id: string; title: string; venue: string; category: string; status: string } | null;
  candidate: { id: string; stage: string } | null;
}

interface DecisionRow {
  id: string;
  marketId: string;
  marketTitle: string;
  venue: Venue;
  predictedProb: number;
  impliedProb: number;
  edge: number;
  action: string;
  reasonCode: string | null;
  reasonCodeLabel: string;
  maxSize: number;
  urgency: string | null;
  reason: string | null;
  confidence: number | null;
  uncertainty: number | null;
  decidedAt: string;
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
}

interface ResearchRunData {
  id: string;
  status: string;
  depth: string;
  startedAt: string | null;
  completedAt: string | null;
  sources: ResearchSource[];
  agentOutputs: AgentOutput[];
  transparencyStages: TransparencyStageRecord[];
  sourceProvenance: Array<{
    url: string;
    title: string | null;
    domain: string | null;
    sourceType: string;
    qualityScore: number | null;
    recencyScore: number | null;
    extractedAt: string;
  }>;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function flattenDecision(d: DecisionApiRecord): DecisionRow {
  const reasonCode = d.reasonCode as string | null;
  return {
    id: d.id,
    marketId: d.marketId,
    marketTitle: d.market?.title ?? 'Unknown Market',
    venue: (d.market?.venue ?? 'POLYMARKET') as Venue,
    predictedProb: d.judgeProbability ?? 0,
    impliedProb: d.impliedProb ?? 0,
    edge: d.edge ?? 0,
    action: d.action,
    reasonCode,
    reasonCodeLabel: reasonCode
      ? (REASON_CODE_DESCRIPTIONS[reasonCode] ?? reasonCode)
      : d.reason ?? '—',
    maxSize: d.maxSize ?? 0,
    urgency: d.urgency,
    reason: d.reason,
    confidence: d.confidence,
    uncertainty: d.uncertainty,
    decidedAt: d.createdAt,
  };
}

function venueLabel(v: Venue): string {
  return VENUE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

function venueColor(v: Venue): string {
  return VENUE_OPTIONS.find((o) => o.value === v)?.color ?? '#888';
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString()}`;
}

function parseAgentOutput(output: string): Record<string, unknown> | null {
  try { return JSON.parse(output); } catch {
    console.warn('Failed to parse agent output as JSON:', output.substring(0, 100));
    return null;
  }
}

const ROLE_COLORS: Record<string, string> = {
  TRIAGE: 'text-violet-400 border-violet-500/30 bg-violet-500/10',
  BULL: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  BEAR: 'text-red-400 border-red-500/30 bg-red-500/10',
  CONTRADICTION: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  JUDGE: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
  DEERFLOW: 'text-indigo-400 border-indigo-500/30 bg-indigo-500/10',
};

const ROLE_ICONS: Record<string, React.ElementType> = {
  TRIAGE: Filter,
  BULL: TrendingUp,
  BEAR: TrendingDown,
  CONTRADICTION: ArrowRight,
  JUDGE: Scale,
  DEERFLOW: Brain,
};

// Stage status colors and icons for transparency audit
const STAGE_STATUS_COLORS: Record<string, string> = {
  running: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  completed: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  failed: 'text-red-400 border-red-500/30 bg-red-500/10',
  skipped: 'text-gray-400 border-gray-500/30 bg-gray-500/10',
  timeout: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
};

const STAGE_STATUS_ICONS: Record<string, React.ElementType> = {
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: SkipForward,
  timeout: AlertTriangle,
};

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── component ────────────────────────────────────────────────────────────────

export function ResearchLedger() {
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [venueFilter, setVenueFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchDecisions() {
      try {
        const res = await fetch('/api/decisions');
        if (res.ok && !cancelled) {
          const data = await res.json();
          const raw = data.decisions ?? [];
          setDecisions(raw.map(flattenDecision));
        }
      } catch {
        // failed to load
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchDecisions();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return decisions.filter((d) => {
      if (
        search &&
        !d.marketTitle.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (venueFilter !== 'ALL' && d.venue !== venueFilter) return false;
      if (actionFilter !== 'ALL' && d.action !== actionFilter) return false;
      return true;
    });
  }, [decisions, search, venueFilter, actionFilter]);

  const summaryStats = useMemo(() => {
    const total = decisions.length;
    const bids = decisions.filter((d) => d.action === 'BID').length;
    const watches = decisions.filter((d) => d.action === 'WATCH').length;
    const skips = decisions.filter((d) => d.action === 'SKIP').length;
    const avgEdge =
      decisions.length > 0
        ? decisions.reduce((s, d) => s + d.edge, 0) / decisions.length
        : 0;
    const totalSize = decisions
      .filter((d) => d.action === 'BID' || d.action === 'WATCH')
      .reduce((s, d) => s + d.maxSize, 0);
    return { total, bids, watches, skips, avgEdge, totalSize };
  }, [decisions]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Research Ledger</h2>
        <div className="h-64 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Research Ledger</h2>
        <p className="mt-1 text-sm text-gray-500">
          Trading decisions and risk engine outputs
        </p>
      </div>

      {/* Empty state when no decisions at all */}
      {decisions.length === 0 ? (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <ClipboardList className="h-7 w-7 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-400">
              No trading decisions yet
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Decisions will appear after markets complete the research pipeline.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              {
                label: 'Total Trades',
                value: summaryStats.total,
                icon: BarChart3,
                color: 'text-white',
              },
              {
                label: 'Bids',
                value: summaryStats.bids,
                icon: TrendingUp,
                color: 'text-emerald-400',
              },
              {
                label: 'Watching',
                value: summaryStats.watches,
                icon: Eye,
                color: 'text-amber-400',
              },
              {
                label: 'Skipped',
                value: summaryStats.skips,
                icon: TrendingDown,
                color: 'text-gray-400',
              },
              {
                label: 'Avg Edge',
                value: `${(summaryStats.avgEdge * 100).toFixed(1)}%`,
                icon: TrendingUp,
                color: 'text-amber-400',
              },
              {
                label: 'Total Size',
                value: formatCurrency(summaryStats.totalSize),
                icon: Target,
                color: 'text-cyan-400',
              },
            ].map((s) => (
              <Card
                key={s.label}
                className="border-gray-800 bg-gray-900"
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <s.icon className={cn('h-4 w-4', s.color, 'opacity-40')} />
                  </div>
                  <p className={cn('mt-1 text-xl font-bold', s.color)}>
                    {s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Filters */}
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <Input
                    placeholder="Search by market title..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="border-gray-700 bg-gray-800 pl-9 text-white placeholder:text-gray-600"
                  />
                </div>
                <div className="flex items-center gap-2">
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
                  <Select value={actionFilter} onValueChange={setActionFilter}>
                    <SelectTrigger className="w-36 border-gray-700 bg-gray-800 text-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-gray-700 bg-gray-900">
                      <SelectItem value="ALL">All Actions</SelectItem>
                      <SelectItem value="BID">BID</SelectItem>
                      <SelectItem value="WATCH">WATCH</SelectItem>
                      <SelectItem value="SKIP">SKIP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Data Table */}
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="w-8" />
                      <TableHead className="text-gray-500">Market</TableHead>
                      <TableHead className="text-gray-500">Venue</TableHead>
                      <TableHead className="text-right text-gray-500">
                        Predicted
                      </TableHead>
                      <TableHead className="text-right text-gray-500">
                        Implied
                      </TableHead>
                      <TableHead className="text-right text-gray-500">Edge</TableHead>
                      <TableHead className="text-gray-500">Action</TableHead>
                      <TableHead className="text-right text-gray-500">Max Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow className="border-gray-800">
                        <TableCell
                          colSpan={8}
                          className="py-8 text-center text-sm text-gray-600"
                        >
                          No decisions match the current filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((d) => (
                        <Fragment key={d.id}>
                          <TableRow
                            className="cursor-pointer border-gray-800 transition-colors hover:bg-gray-800/50"
                            onClick={() =>
                              setExpandedId(expandedId === d.id ? null : d.id)
                            }
                          >
                            <TableCell className="w-8 px-3">
                              {expandedId === d.id ? (
                                <ChevronDown className="h-4 w-4 text-gray-500" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-gray-600" />
                              )}
                            </TableCell>
                            <TableCell>
                              <p className="max-w-[200px] truncate text-sm text-gray-200">
                                {d.marketTitle}
                              </p>
                            </TableCell>
                            <TableCell>
                              <span
                                className="text-xs font-medium"
                                style={{ color: venueColor(d.venue) }}
                              >
                                {venueLabel(d.venue)}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm tabular-nums text-gray-300">
                                {(d.predictedProb * 100).toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm tabular-nums text-gray-300">
                                {(d.impliedProb * 100).toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span
                                className={cn(
                                  'text-sm font-medium tabular-nums',
                                  d.edge >= 0.05
                                    ? 'text-emerald-400'
                                    : d.edge >= 0
                                      ? 'text-amber-400'
                                      : 'text-red-400'
                                )}
                              >
                                {d.edge >= 0 ? '+' : ''}
                                {(d.edge * 100).toFixed(1)}%
                              </span>
                            </TableCell>
                            <TableCell>
                              {d.action === 'BID' ? (
                                <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                                  BID
                                </Badge>
                              ) : d.action === 'WATCH' ? (
                                <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400">
                                  WATCH
                                </Badge>
                              ) : (
                                <Badge className="border-gray-500/30 bg-gray-500/10 text-gray-500">
                                  SKIP
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="text-sm tabular-nums text-gray-300">
                                {formatCurrency(d.maxSize)}
                              </span>
                            </TableCell>
                          </TableRow>
                          {expandedId === d.id && (
                            <TableRow key={`${d.id}-detail`} className="border-gray-800 bg-gray-900/80">
                              <TableCell colSpan={8} className="p-0">
                                <InlineDecisionDetail decision={d} onClose={() => setExpandedId(null)} />
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
        </>
      )}
    </div>
  );
}

function InlineDecisionDetail({
  decision: d,
  onClose,
}: {
  decision: DecisionRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [research, setResearch] = useState<ResearchRunData[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function fetchData() {
      try {
        const res = await fetch(`/api/research?marketId=${d.marketId}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setResearch(data.researchRuns ?? []);
        }
      } catch {
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [d]);

  const latestResearch = research[0];
  const agentOutputs = latestResearch?.agentOutputs ?? [];
  const sources = latestResearch?.sources ?? [];
  const provenance = latestResearch?.sourceProvenance ?? [];
  const transparencyStages = latestResearch?.transparencyStages ?? [];

  // Sort stages in pipeline order (unknown stages sorted to end)
  const sortedStages = [...transparencyStages].sort((a, b) => {
    const order = ['TRIAGE', 'BULL', 'BEAR', 'CONTRADICTION', 'JUDGE', 'DEERFLOW', 'NEWS_ANALYST', 'SENTIMENT_ANALYST', 'TECHNICAL_ANALYST', 'SYNTHESIS'];
    const aIndex = order.indexOf(a.stage);
    const bIndex = order.indexOf(b.stage);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  // Filter debate and judge stages
  const debateStages = sortedStages.filter(s => ['BULL', 'BEAR', 'CONTRADICTION', 'JUDGE'].includes(s.stage));
  const hasDebate = debateStages.length > 0;

  // Non-debate stages
  const otherStages = sortedStages.filter(s => !['BULL', 'BEAR', 'CONTRADICTION', 'JUDGE'].includes(s.stage));

  // Sort agents for legacy display (unknown roles sorted to end)
  const sortedAgents = [...agentOutputs].sort((a, b) => {
    const order = ['TRIAGE', 'BULL', 'BEAR', 'CONTRADICTION', 'JUDGE', 'DEERFLOW', 'NEWS_ANALYST', 'SENTIMENT_ANALYST', 'TECHNICAL_ANALYST', 'SYNTHESIS'];
    const aIndex = order.indexOf(a.role);
    const bIndex = order.indexOf(b.role);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-white">{d.marketTitle}</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge className={cn(
              d.action === 'BID' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' :
              d.action === 'WATCH' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' :
              'border-gray-500/30 bg-gray-500/10 text-gray-500'
            )}>
              {d.action}
            </Badge>
            {d.reasonCode && (
              <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px]">
                {d.reasonCode}
              </Badge>
            )}
            {d.urgency && (
              <Badge className={cn('text-[10px]', d.urgency === 'IMMEDIATE' ? 'border-red-500/30 bg-red-500/10 text-red-400' : d.urgency === 'HIGH' ? 'border-amber-500/30 bg-amber-500/10 text-amber-400' : 'border-gray-500/30 bg-gray-500/10 text-gray-500')}>
                {d.urgency}
              </Badge>
            )}
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
            onClick={() => router.push(`/market/${d.marketId}`)}
            className="h-6 text-[10px] border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
          >
            <FileText className="h-3 w-3 mr-1" />
            Full Detail
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-500 h-6 text-[10px]">Close</Button>
        </div>
        </div>
        {/* Decision metrics */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <p className="mb-1 text-xs font-semibold text-emerald-400">Risk Decision</p>
            <p className="text-xs leading-relaxed text-gray-400">{d.reason ?? 'No reason recorded'}</p>
          </div>
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
            <p className="mb-1 text-xs font-semibold text-purple-400">Reason Code</p>
            <p className="text-xs leading-relaxed text-gray-400">{d.reasonCodeLabel || 'No reason code'}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Predicted</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{(d.predictedProb * 100).toFixed(1)}%</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Implied</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{(d.impliedProb * 100).toFixed(1)}%</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Edge</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{d.edge >= 0 ? '+' : ''}{(d.edge * 100).toFixed(2)}%</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
            <p className="text-[11px] text-gray-500">Max Size</p>
            <p className="mt-1 text-sm font-bold text-gray-200">{formatCurrency(d.maxSize)}</p>
          </div>
          {d.confidence != null && (
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] text-gray-500">Confidence</p>
              <p className="mt-1 text-sm font-bold text-cyan-400">{(d.confidence * 100).toFixed(0)}%</p>
            </div>
          )}
          {d.uncertainty != null && (
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] text-gray-500">Uncertainty</p>
              <p className="mt-1 text-sm font-bold text-amber-400">{(d.uncertainty * 100).toFixed(0)}%</p>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
            <span className="ml-2 text-sm text-gray-500">Loading research data...</span>
          </div>
        )}

        {/* Stage Transparency Audit Trail */}
        {!loading && sortedStages.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
              <Activity className="h-3.5 w-3.5" />
              Research Transparency Audit
            </h4>
            <div className="space-y-2">
              {otherStages.map((stage) => {
                const isExpanded = expandedStage === `${stage.stage}-${stage.serviceName}-${stage.startedAt}`;
                const statusColor = STAGE_STATUS_COLORS[stage.status] ?? STAGE_STATUS_COLORS.completed;
                const StatusIcon = STAGE_STATUS_ICONS[stage.status] ?? CheckCircle2;

                return (
                  <div key={`${stage.stage}-${stage.serviceName}-${stage.startedAt}`} className="rounded-lg border border-gray-800 bg-gray-800/20">
                    <button
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-800/50"
                      onClick={() => setExpandedStage(isExpanded ? null : `${stage.stage}-${stage.serviceName}-${stage.startedAt}`)}
                    >
                      <div className="flex items-center gap-2">
                        <StatusIcon className={cn("h-3.5 w-3.5", stage.status === 'running' && "animate-spin")} />
                        <Badge className={cn('text-[10px]', statusColor)}>{stage.status}</Badge>
                        <span className="text-sm font-medium text-gray-300">{stage.stage}</span>
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
                        {/* Service and Model Info */}
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
                          {stage.startedAt && stage.startedAt !== '' && (
                            <div>
                              <span className="text-gray-500">Started:</span>{' '}
                              <span className="text-gray-300">{new Date(stage.startedAt).toLocaleTimeString()}</span>
                            </div>
                          )}
                        </div>

                        {/* Failure Reason */}
                        {stage.failureReason && (
                          <div className="rounded bg-red-500/10 border border-red-500/20 p-2">
                            <p className="text-[10px] text-red-400 font-medium">Failure Reason</p>
                            <p className="text-xs text-red-300">{stage.failureReason}</p>
                          </div>
                        )}

                        {/* Summary */}
                        {stage.summary && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">Summary</p>
                            <p className="text-xs text-gray-300">{stage.summary}</p>
                          </div>
                        )}

                        {/* Raw Output (Expandable) */}
                        {stage.rawOutput && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">Raw Output</p>
                            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px] text-gray-400 bg-gray-900/50 p-2 rounded">{stage.rawOutput}</pre>
                          </div>
                        )}

                        {/* References with Source Links */}
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

                        {/* Sources */}
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
              {debateStages.map((stage) => {
                const isExpanded = expandedStage === `debate-${stage.stage}-${stage.serviceName}-${stage.startedAt}`;
                const statusColor = STAGE_STATUS_COLORS[stage.status] ?? STAGE_STATUS_COLORS.completed;
                const StatusIcon = STAGE_STATUS_ICONS[stage.status] ?? CheckCircle2;
                const isJudge = stage.stage === 'JUDGE';
                const isContradiction = stage.stage === 'CONTRADICTION';

                return (
                  <div key={`debate-${stage.stage}-${stage.serviceName}-${stage.startedAt}`} className={cn(
                    "rounded-lg border bg-gray-800/40",
                    (isJudge || isContradiction) ? "border-cyan-500/40 shadow-sm shadow-cyan-500/5" : "border-gray-800"
                  )}>
                    <button
                      className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-800/60"
                      onClick={() => setExpandedStage(isExpanded ? null : `debate-${stage.stage}-${stage.serviceName}-${stage.startedAt}`)}
                    >
                      <div className="flex items-center gap-2">
                        <StatusIcon className={cn("h-3.5 w-3.5", stage.status === 'running' && "animate-spin")} />
                        <Badge className={cn('text-[10px]', statusColor)}>{stage.status}</Badge>
                        <span className={cn("text-sm font-medium", isJudge ? "text-cyan-400" : "text-gray-300")}>
                          {stage.stage}
                        </span>
                        {isJudge && <span className="text-[10px] text-cyan-400 font-medium">Final Verdict</span>}
                        {isContradiction && <span className="text-[10px] text-amber-400 font-medium">Debate</span>}
                        {stage.model && <span className="text-[10px] text-gray-600">{stage.model}</span>}
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
                        {/* Service and Model Info */}
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
                          {stage.startedAt && stage.startedAt !== '' && (
                            <div>
                              <span className="text-gray-500">Started:</span>{' '}
                              <span className="text-gray-300">{new Date(stage.startedAt).toLocaleTimeString()}</span>
                            </div>
                          )}
                        </div>

                        {/* Failure Reason */}
                        {stage.failureReason && (
                          <div className="rounded bg-red-500/10 border border-red-500/20 p-2">
                            <p className="text-[10px] text-red-400 font-medium">Failure Reason</p>
                            <p className="text-xs text-red-300">{stage.failureReason}</p>
                          </div>
                        )}

                        {/* Summary */}
                        {stage.summary && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">Summary</p>
                            <p className="text-xs text-gray-300">{stage.summary}</p>
                          </div>
                        )}

                        {/* Raw Output (Expandable) */}
                        {stage.rawOutput && (
                          <div>
                            <p className="text-[10px] text-gray-500 mb-1">Raw Output</p>
                            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px] text-gray-400 bg-gray-900/50 p-2 rounded">{stage.rawOutput}</pre>
                          </div>
                        )}

                        {/* References */}
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

        {/* Legacy Agent Pipeline (fallback) */}
        {!loading && sortedAgents.length > 0 && otherStages.length === 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Agent Pipeline</h4>
            <div className="space-y-2">
              {sortedAgents.map((agent) => {
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

        {/* Source Provenance with full details */}
        {!loading && provenance.length > 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-2">
              <BookOpen className="h-3.5 w-3.5" />
              Source Provenance ({provenance.length})
            </h4>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {provenance.slice(0, 15).map((src, idx) => (
                <div key={idx} className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-800/40">
                  <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-gray-600" />
                  <div className="min-w-0 flex-1">
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-xs text-cyan-400 hover:underline block"
                    >
                      {src.title || src.url}
                    </a>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {src.domain && <span className="text-[10px] text-gray-600">{src.domain}</span>}
                      <Badge variant="outline" className="text-[9px] border-gray-700 bg-gray-800 text-gray-400">
                        {src.sourceType}
                      </Badge>
                      {src.qualityScore !== null && (
                        <span className="text-[10px] text-emerald-400">Q:{src.qualityScore.toFixed(1)}</span>
                      )}
                      {src.recencyScore !== null && (
                        <span className="text-[10px] text-blue-400">R:{src.recencyScore.toFixed(1)}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {provenance.length > 15 && (
                <p className="text-[10px] text-gray-600 text-center py-1">+ {provenance.length - 15} more sources</p>
              )}
            </div>
          </div>
        )}

        {/* Legacy Sources (fallback) */}
        {!loading && sources.length > 0 && provenance.length === 0 && (
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
              Research Sources ({sources.length})
            </h4>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {sources.slice(0, 15).map((src) => (
                <div key={src.id} className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-800/40">
                  <Search className="mt-0.5 h-3 w-3 shrink-0 text-gray-600" />
                  <div className="min-w-0">
                    <p className="truncate text-xs text-gray-300">{src.title || src.url}</p>
                    <p className="truncate text-[10px] text-gray-600">{src.url}</p>
                    {src.content && src.content.length > 0 && (
                      <p className="mt-0.5 line-clamp-2 text-[10px] text-gray-500">{src.content.slice(0, 200)}</p>
                    )}
                  </div>
                </div>
              ))}
              {sources.length > 15 && (
                <p className="text-[10px] text-gray-600 text-center py-1">+ {sources.length - 15} more sources</p>
              )}
            </div>
          </div>
        )}

        {!loading && !latestResearch && (
          <div className="rounded-lg border border-gray-800 bg-gray-800/20 p-4 text-center">
            <p className="text-sm text-gray-500">No research data for this market</p>
            <p className="mt-1 text-xs text-gray-600">The research pipeline may not have completed for this market</p>
          </div>
        )}

        <div className="flex items-center gap-4 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Decided: {new Date(d.decidedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </span>
          {latestResearch?.completedAt && (
            <span className="flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              Research: {new Date(latestResearch.completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
    </div>
  );
}
