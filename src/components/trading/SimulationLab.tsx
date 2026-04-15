'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  FlaskConical,
  Play,
  Square,
  RotateCcw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Brain,
  Scale,
  ShieldAlert,
  Zap,
  BookOpen,
  Filter,
  ScanSearch,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Clock,
  TrendingUp,
  BarChart3,
  Activity,
  Bot,
  Target,
  FileText,
  Eye,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { VENUE_OPTIONS, CATEGORY_OPTIONS } from '@/lib/constants';
import type { Venue } from '@/lib/types';

// ── Types ────────────────────────────────────────────────────────────────────

interface SimulationReport {
  id: string;
  startedAt: string;
  completedAt: string;
  config: {
    marketCount: number;
    venues: string[];
    categories: string[];
    speed?: string;
  };
  results: MarketResult[];
  summary: {
    totalMarkets: number;
    scanned: number;
    triagedRelevant: number;
    researched: number;
    judged: number;
    riskBuy: number;
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

interface MarketResult {
  marketId: string;
  title: string;
  venue: Venue;
  category: string;
  impliedProb: number;
  liquidity: number;
  spread: number;
  triageResult: {
    status: string;
    reason: string;
    worthResearch: boolean;
  };
  bullOutput: {
    thesis: string;
    keyArguments: string[];
    estimatedProbability: number;
    confidence: number;
  } | null;
  bearOutput: {
    thesis: string;
    keyArguments: string[];
    estimatedProbability: number;
    confidence: number;
  } | null;
  contradictionOutput: {
    contradictions: string[];
    overlookedRisks: string[];
    alternativeInterpretations: string[];
    reliabilityAssessment: number;
  } | null;
  judgeOutput: {
    trueProbability: number;
    confidence: number;
    uncertainty: number;
    proEvidence: string[];
    antiEvidence: string[];
    catalystTiming: string;
    skipReason?: string;
  } | null;
  riskResult: {
    action: string;
    side?: string;
    maxSize: number;
    adjustedSize: number;
    urgency: string;
    reasonCode?: string;
    reason: string;
    edge: number;
  } | null;
  simulatedOrder: {
    side: string;
    price: number;
    size: number;
    estimatedPnl: number;
  } | null;
  stage: string;
  durationMs: number;
  error: string | null;
}

type PipelineStage = 'IDLE' | 'CONFIGURING' | 'SCANNING' | 'TRIAGING' | 'RESEARCHING' | 'JUDGING' | 'RISKING' | 'EXECUTING' | 'COMPLETE' | 'ERROR';

// ── Pipeline Stages Config ──────────────────────────────────────────────────

const PIPELINE_STAGES: { key: PipelineStage; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'IDLE', label: 'Idle', icon: FlaskConical, color: 'text-gray-500' },
  { key: 'CONFIGURING', label: 'Config', icon: FlaskConical, color: 'text-blue-400' },
  { key: 'SCANNING', label: 'Scanning', icon: ScanSearch, color: 'text-blue-400' },
  { key: 'TRIAGING', label: 'Triage', icon: Filter, color: 'text-violet-400' },
  { key: 'RESEARCHING', label: 'Research', icon: BookOpen, color: 'text-amber-400' },
  { key: 'JUDGING', label: 'Judge', icon: Scale, color: 'text-emerald-400' },
  { key: 'RISKING', label: 'Risk', icon: ShieldAlert, color: 'text-red-400' },
  { key: 'EXECUTING', label: 'Execute', icon: Zap, color: 'text-cyan-400' },
  { key: 'COMPLETE', label: 'Done', icon: CheckCircle2, color: 'text-emerald-400' },
  { key: 'ERROR', label: 'Error', icon: XCircle, color: 'text-red-400' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    SCANNED: 'Scanned', TRIAGED: 'Triaged', RESEARCHING: 'Researching',
    JUDGED: 'Judged', DECIDED: 'Decided', EXECUTED: 'Executed',
  };
  return map[stage] ?? stage;
}

function stageColor(stage: string): string {
  const map: Record<string, string> = {
    SCANNED: 'bg-gray-500', TRIAGED: 'bg-blue-500', RESEARCHING: 'bg-amber-500',
    JUDGED: 'bg-purple-500', DECIDED: 'bg-orange-500', EXECUTED: 'bg-green-500',
  };
  return map[stage] ?? 'bg-gray-500';
}

// ── Component ────────────────────────────────────────────────────────────────

export function SimulationLab() {
  // Config state
  const [marketCount, setMarketCount] = useState(5);
  const [selectedVenues, setSelectedVenues] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [speed, setSpeed] = useState<string>('normal');

  // Simulation state
  const [isRunning, setIsRunning] = useState(false);
  const [currentStage, setCurrentStage] = useState<PipelineStage>('IDLE');
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<SimulationReport | null>(null);
  const [expandedMarket, setExpandedMarket] = useState<string | null>(null);

  const abortRef = useRef(false);

  // ── Config handlers ───────────────────────────────────────────────────────

  const toggleVenue = (venue: string) => {
    setSelectedVenues((prev) =>
      prev.includes(venue) ? prev.filter((v) => v !== venue) : [...prev, venue],
    );
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  // ── Simulation runner ────────────────────────────────────────────────────

  const startSimulation = useCallback(async () => {
    if (isRunning) return;

    setIsRunning(true);
    setReport(null);
    setExpandedMarket(null);
    abortRef.current = false;

    // Simulate stage progression for UI feedback
    const stages: PipelineStage[] = [
      'CONFIGURING', 'SCANNING', 'TRIAGING', 'RESEARCHING', 'JUDGING', 'RISKING', 'EXECUTING',
    ];

    let stageIndex = 0;
    const stageProgressInterval = setInterval(() => {
      if (abortRef.current) {
        clearInterval(stageProgressInterval);
        return;
      }
      const elapsed = Date.now();
      const stageProgress = Math.min(
        95,
        ((elapsed % 3000) / 3000) * 100,
      );
      setProgress(stageProgress);
    }, 200);

    // Progress through stages with timing
    const advanceStages = async () => {
      for (const stage of stages) {
        if (abortRef.current) break;
        setCurrentStage(stage);
        await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200));
      }
    };
    advanceStages();

    try {
      const res = await fetch('/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketCount,
          venues: selectedVenues,
          categories: selectedCategories,
          speed,
        }),
      });

      clearInterval(stageProgressInterval);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Simulation failed');
      }

      const data: SimulationReport = await res.json();
      setCurrentStage('COMPLETE');
      setProgress(100);
      setReport(data);

      toast.success('Simulation Complete', {
        description: `${data.summary.executed} orders simulated in ${formatDuration(data.summary.totalDurationMs)}`,
      });
    } catch (err) {
      clearInterval(stageProgressInterval);
      setCurrentStage('ERROR');
      setProgress(0);
      toast.error('Simulation Failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, marketCount, selectedVenues, selectedCategories, speed]);

  const cancelSimulation = useCallback(() => {
    abortRef.current = true;
    setIsRunning(false);
    setCurrentStage('IDLE');
    setProgress(0);
    toast.info('Simulation cancelled');
  }, []);

  const resetSimulation = useCallback(() => {
    setReport(null);
    setCurrentStage('IDLE');
    setProgress(0);
    setExpandedMarket(null);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-600/20">
              <FlaskConical className="h-4 w-4 text-purple-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Simulation Lab</h2>
            {isRunning && (
              <Badge className="gap-1 border-purple-500/30 bg-purple-500/10 text-purple-400 text-[10px]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-purple-400" />
                Running
              </Badge>
            )}
            {report && !isRunning && (
              <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]">
                <CheckCircle2 className="h-3 w-3" />
                {report.summary.executed} trades
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Dry-run the entire agent pipeline — scan, triage, research, judge, risk check, and simulate execution
          </p>
        </div>
        <div className="flex items-center gap-2">
          {report && !isRunning && (
            <Button variant="ghost" size="sm" onClick={resetSimulation} className="text-gray-400 hover:text-white">
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          )}
          {isRunning ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={cancelSimulation}
              className="gap-2"
            >
              <Square className="h-4 w-4" />
              Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={startSimulation}
              disabled={marketCount < 1 || marketCount > 20}
              className="gap-2 bg-purple-600 text-white hover:bg-purple-700"
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Run Simulation
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline Progress */}
      {isRunning && (
        <Card className="border-purple-500/30 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
              <span className="text-sm font-medium text-white">Pipeline Active</span>
              <span className="text-xs text-gray-500 ml-auto">
                {Math.round(progress)}%
              </span>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {PIPELINE_STAGES.filter((s) => s.key !== 'IDLE' && s.key !== 'ERROR').map((stage, idx) => {
                const stageIdx = ['CONFIGURING', 'SCANNING', 'TRIAGING', 'RESEARCHING', 'JUDGING', 'RISKING', 'EXECUTING'].indexOf(currentStage);
                const isActive = currentStage === stage.key;
                const isDone = stageIdx >= 0 && idx <= stageIdx;
                const Icon = stage.icon;

                return (
                  <div key={stage.key} className="flex items-center">
                    <div
                      className={cn(
                        'flex min-w-[80px] flex-col items-center gap-1 rounded-lg border px-3 py-2.5 transition-all sm:min-w-[95px]',
                        isActive
                          ? 'border-purple-500/50 bg-purple-500/10 shadow-sm shadow-purple-500/10'
                          : isDone
                            ? 'border-emerald-500/30 bg-emerald-500/5'
                            : 'border-gray-800 bg-gray-800/40',
                      )}
                    >
                      <div className="relative">
                        <Icon
                          className={cn(
                            'h-4 w-4 transition-colors',
                            isActive ? 'text-purple-400' : isDone ? 'text-emerald-400' : 'text-gray-600',
                          )}
                        />
                        {isActive && (
                          <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-purple-400" />
                        )}
                        {isDone && !isActive && (
                          <CheckCircle2 className="absolute -right-1.5 -top-1.5 h-3 w-3 text-emerald-400" />
                        )}
                      </div>
                      <span className={cn(
                        'text-[10px] font-medium',
                        isActive ? 'text-purple-300' : isDone ? 'text-emerald-300/70' : 'text-gray-600',
                      )}>
                        {stage.label}
                      </span>
                    </div>
                    {idx < PIPELINE_STAGES.length - 3 && (
                      <ArrowRight className={cn(
                        'mx-0.5 h-3 w-3 shrink-0',
                        isDone ? 'text-emerald-500/50' : 'text-gray-700',
                      )} />
                    )}
                  </div>
                );
              })}
            </div>
            <Progress value={progress} className="mt-3 h-1.5 [&>div]:bg-purple-500" />
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {currentStage === 'ERROR' && !isRunning && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="flex items-center gap-3 p-4">
            <XCircle className="h-5 w-5 text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-400">Simulation Failed</p>
              <p className="text-xs text-red-400/70">Check the console for error details and try again</p>
            </div>
            <Button variant="outline" size="sm" onClick={startSimulation} className="ml-auto border-red-500/30 text-red-400 hover:bg-red-500/10">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ─── Left: Configuration Panel ─── */}
        <div className="space-y-4 lg:col-span-1">
          <Card className="border-gray-800 bg-gray-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <FlaskConical className="h-4 w-4 text-purple-400" />
                Configuration
              </CardTitle>
              <CardDescription className="text-gray-500">
                Configure the simulation parameters
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Market count */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-gray-300">Markets to Simulate</Label>
                  <span className="text-sm font-bold tabular-nums text-purple-400">{marketCount}</span>
                </div>
                <Slider
                  value={[marketCount]}
                  min={1}
                  max={20}
                  step={1}
                  onValueChange={([v]) => setMarketCount(v)}
                  className="py-1"
                />
                <div className="flex justify-between text-[11px] text-gray-600">
                  <span>1</span>
                  <span>10</span>
                  <span>20</span>
                </div>
              </div>

              <Separator className="bg-gray-800" />

              {/* Venue selection */}
              <div className="space-y-2">
                <Label className="text-sm text-gray-300">Venues</Label>
                <p className="text-[11px] text-gray-600">Leave empty for all</p>
                <div className="space-y-1.5">
                  {VENUE_OPTIONS.map((venue) => {
                    const selected = selectedVenues.includes(venue.value);
                    return (
                      <button
                        key={venue.value}
                        onClick={() => toggleVenue(venue.value)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors',
                          selected
                            ? 'border-purple-500/40 bg-purple-500/10 text-purple-300'
                            : 'border-gray-800 bg-gray-800/40 text-gray-400 hover:border-gray-700',
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: venue.color }} />
                          <span>{venue.label}</span>
                        </div>
                        {selected && <CheckCircle2 className="h-3.5 w-3.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Separator className="bg-gray-800" />

              {/* Category selection */}
              <div className="space-y-2">
                <Label className="text-sm text-gray-300">Categories</Label>
                <p className="text-[11px] text-gray-600">Leave empty for all</p>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_OPTIONS.map((cat) => {
                    const selected = selectedCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={cn(
                          'rounded-md border px-2 py-1 text-[11px] capitalize transition-colors',
                          selected
                            ? 'border-purple-500/40 bg-purple-500/10 text-purple-300'
                            : 'border-gray-800 bg-gray-800/40 text-gray-500 hover:border-gray-700',
                        )}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Separator className="bg-gray-800" />

              {/* Speed */}
              <div className="space-y-2">
                <Label className="text-sm text-gray-300">Speed</Label>
                <Select value={speed} onValueChange={setSpeed}>
                  <SelectTrigger className="border-gray-700 bg-gray-800 text-gray-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-gray-700 bg-gray-900">
                    <SelectItem value="fast">Fast (minimal detail)</SelectItem>
                    <SelectItem value="normal">Normal (balanced)</SelectItem>
                    <SelectItem value="detailed">Detailed (full logs)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Agent Legend */}
          <Card className="border-gray-800 bg-gray-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Bot className="h-4 w-4 text-gray-400" />
                Agent Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { icon: ScanSearch, label: 'Scanner', desc: 'Discovers & snapshots markets', color: 'text-blue-400' },
                { icon: Filter, label: 'Triage Agent', desc: 'Classifies relevance', color: 'text-violet-400' },
                { icon: BookOpen, label: 'Research Agents', desc: 'Bull + Bear + Contradiction', color: 'text-amber-400' },
                { icon: Scale, label: 'Judge Agent', desc: 'Synthesizes probability estimate', color: 'text-emerald-400' },
                { icon: ShieldAlert, label: 'Risk Engine', desc: 'Deterministic risk checks', color: 'text-red-400' },
                { icon: Zap, label: 'Executor', desc: 'Simulated order placement', color: 'text-cyan-400' },
              ].map((agent) => (
                <div key={agent.label} className="flex items-start gap-2.5 rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2">
                  <agent.icon className={cn('mt-0.5 h-4 w-4 shrink-0', agent.color)} />
                  <div>
                    <p className="text-xs font-medium text-gray-300">{agent.label}</p>
                    <p className="text-[10px] text-gray-600">{agent.desc}</p>
                  </div>
                </div>
              ))}
              <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-[11px] text-amber-400/80">
                  <AlertTriangle className="mr-1 inline h-3 w-3" />
                  Dry-run only — no real trades will be executed
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── Right: Results Panel ─── */}
        <div className="space-y-4 lg:col-span-2">
          {/* No results yet */}
          {!report && !isRunning && (
            <Card className="border-gray-800 bg-gray-900">
              <CardContent className="flex flex-col items-center justify-center py-20">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-purple-500/10">
                  <FlaskConical className="h-7 w-7 text-purple-400/60" />
                </div>
                <p className="text-sm font-medium text-gray-400">Ready to Simulate</p>
                <p className="mt-1 max-w-md text-center text-xs text-gray-600">
                  Configure your simulation parameters and click &quot;Run Simulation&quot; to test the full agent pipeline with realistic mock markets.
                  All agents will process markets through triage, research, judging, and risk assessment — without executing real trades.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {['Scan', 'Triage', 'Research', 'Judge', 'Risk', 'Execute'].map((step, i) => (
                    <Badge key={step} variant="outline" className="border-gray-700 text-[10px] text-gray-500">
                      {i > 0 && <ArrowRight className="mr-1 inline h-2.5 w-2.5" />}
                      {step}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary Dashboard */}
          {report && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {[
                  { label: 'Markets', value: report.summary.totalMarkets, icon: Target, color: 'text-purple-400', sub: `in ${formatDuration(report.summary.totalDurationMs)}` },
                  { label: 'Relevant', value: report.summary.triagedRelevant, icon: Filter, color: 'text-blue-400', sub: `${report.summary.triagedRelevant}/${report.summary.totalMarkets} passed triage` },
                  { label: 'Buy Signals', value: report.summary.riskBuy, icon: TrendingUp, color: 'text-emerald-400', sub: `${report.summary.riskSkip} skipped` },
                  { label: 'Executed', value: report.summary.executed, icon: Zap, color: 'text-cyan-400', sub: `${report.summary.executed} simulated orders` },
                  { label: 'Est. PnL', value: `$${report.summary.totalEstimatedPnl.toFixed(2)}`, icon: DollarSign, color: report.summary.totalEstimatedPnl >= 0 ? 'text-emerald-400' : 'text-red-400', sub: `exposure: ${formatCurrency(report.summary.totalExposure)}` },
                  { label: 'Avg Edge', value: `${(report.summary.avgEdge * 100).toFixed(2)}%`, icon: BarChart3, color: 'text-amber-400', sub: `confidence: ${(report.summary.avgConfidence * 100).toFixed(1)}%` },
                ].map((s) => (
                  <Card key={s.label} className="border-gray-800 bg-gray-900">
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <s.icon className={cn('h-3.5 w-3.5', s.color)} />
                        <span className="text-lg font-bold tabular-nums text-white">{s.value}</span>
                      </div>
                      <p className="mt-1 text-[11px] font-medium text-gray-400">{s.label}</p>
                      <p className="text-[10px] text-gray-600">{s.sub}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Pipeline Funnel */}
              <Card className="border-gray-800 bg-gray-900">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm text-white">
                    <Activity className="h-4 w-4 text-gray-400" />
                    Pipeline Funnel
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="flex items-end gap-1.5 justify-center">
                    {[
                      { label: 'Scanned', count: report.summary.scanned, color: 'bg-blue-500', max: report.summary.totalMarkets },
                      { label: 'Relevant', count: report.summary.triagedRelevant, color: 'bg-violet-500', max: report.summary.totalMarkets },
                      { label: 'Researched', count: report.summary.researched, color: 'bg-amber-500', max: report.summary.totalMarkets },
                      { label: 'Judged', count: report.summary.judged, color: 'bg-purple-500', max: report.summary.totalMarkets },
                      { label: 'Buy', count: report.summary.riskBuy, color: 'bg-emerald-500', max: report.summary.totalMarkets },
                      { label: 'Executed', count: report.summary.executed, color: 'bg-cyan-500', max: report.summary.totalMarkets },
                    ].map((bar) => (
                      <div key={bar.label} className="flex flex-col items-center gap-1.5">
                        <span className="text-xs font-bold tabular-nums text-white">{bar.count}</span>
                        <div
                          className={cn('w-10 rounded-t-md transition-all', bar.color)}
                          style={{ height: `${Math.max(8, (bar.count / bar.max) * 100)}px` }}
                        />
                        <span className="text-[9px] text-gray-500">{bar.label}</span>
                      </div>
                    ))}
                  </div>
                  {report.summary.errors > 0 && (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-1.5">
                      <AlertTriangle className="h-3 w-3 text-red-400" />
                      <span className="text-[11px] text-red-400">{report.summary.errors} error(s) encountered during simulation</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Market Results Table */}
              <Card className="border-gray-800 bg-gray-900">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm text-white">
                    <Eye className="h-4 w-4 text-gray-400" />
                    Market Results
                  </CardTitle>
                  <CardDescription className="text-gray-500">
                    Click any row to inspect the full agent pipeline for that market
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[500px] overflow-y-auto">
                    {report.results.map((result, idx) => (
                      <div key={result.marketId || idx}>
                        {/* Row */}
                        <button
                          onClick={() => setExpandedMarket(expandedMarket === String(idx) ? null : String(idx))}
                          className={cn(
                            'flex w-full items-center gap-3 border-b border-gray-800/50 px-4 py-3 text-left transition-colors hover:bg-gray-800/30',
                            expandedMarket === String(idx) && 'bg-gray-800/20',
                          )}
                        >
                          <div className="w-6 text-center">
                            {expandedMarket === String(idx) ? (
                              <ChevronDown className="mx-auto h-4 w-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="mx-auto h-4 w-4 text-gray-600" />
                            )}
                          </div>

                          {/* Stage indicator */}
                          <span className={cn('h-2 w-2 shrink-0 rounded-full', stageColor(result.stage))} />

                          {/* Title */}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-gray-200">{result.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-gray-600">{result.venue}</span>
                              <span className="text-[10px] text-gray-700">|</span>
                              <span className="text-[10px] text-gray-600">{result.category}</span>
                              <span className="text-[10px] text-gray-700">|</span>
                              <span className="text-[10px] tabular-nums text-gray-600">
                                {(result.impliedProb * 100).toFixed(1)}%
                              </span>
                            </div>
                          </div>

                          {/* Triage */}
                          <Badge className={cn(
                            'text-[10px]',
                            result.triageResult.status === 'RELEVANT'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                              : result.triageResult.status === 'AMBIGUOUS'
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                : 'border-gray-500/30 bg-gray-500/10 text-gray-500',
                          )}>
                            {result.triageResult.status}
                          </Badge>

                          {/* Risk action */}
                          {result.riskResult && (
                            <Badge className={cn(
                              'text-[10px]',
                              result.riskResult.action === 'BUY'
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                : 'border-red-500/30 bg-red-500/10 text-red-400',
                            )}>
                              {result.riskResult.action}
                            </Badge>
                          )}

                          {/* Order */}
                          {result.simulatedOrder && (
                            <div className="text-right shrink-0">
                              <p className={cn(
                                'text-xs font-bold tabular-nums',
                                result.simulatedOrder.estimatedPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
                              )}>
                                {result.simulatedOrder.estimatedPnl >= 0 ? '+' : ''}
                                ${result.simulatedOrder.estimatedPnl.toFixed(2)}
                              </p>
                              <p className="text-[10px] text-gray-600">
                                {result.simulatedOrder.side} @ ${(result.simulatedOrder.price * 100).toFixed(1)}c
                              </p>
                            </div>
                          )}

                          {/* Error */}
                          {result.error && (
                            <Badge className="border-red-500/30 bg-red-500/10 text-red-400 text-[10px]">
                              ERROR
                            </Badge>
                          )}

                          {/* Duration */}
                          <span className="shrink-0 text-[10px] tabular-nums text-gray-600">
                            {formatDuration(result.durationMs)}
                          </span>
                        </button>

                        {/* Expanded detail */}
                        {expandedMarket === String(idx) && (
                          <div className="border-b border-gray-800/50 bg-gray-900/50 px-4 py-4">
                            <MarketDetail result={result} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Market Detail Sub-component ──────────────────────────────────────────────

function MarketDetail({ result }: { result: MarketResult }) {
  return (
    <Accordion type="multiple" defaultValue={['triage']} className="space-y-2">
      {/* Market Info */}
      <AccordionItem value="info" className="border-gray-800">
        <AccordionTrigger className="py-2 text-xs font-medium text-gray-300 hover:no-underline">
          Market Data
        </AccordionTrigger>
        <AccordionContent className="pb-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Implied Prob', value: `${(result.impliedProb * 100).toFixed(1)}%` },
              { label: 'Liquidity', value: formatCurrency(result.liquidity) },
              { label: 'Spread', value: `${(result.spread * 100).toFixed(2)}%` },
              { label: 'Final Stage', value: stageLabel(result.stage) },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2">
                <p className="text-[10px] text-gray-500">{s.label}</p>
                <p className="text-sm font-bold text-gray-200">{s.value}</p>
              </div>
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Triage Result */}
      <AccordionItem value="triage" className="border-gray-800">
        <AccordionTrigger className="py-2 text-xs font-medium text-gray-300 hover:no-underline">
          <div className="flex items-center gap-2">
            <Filter className="h-3 w-3 text-violet-400" />
            Triage Agent Output
          </div>
        </AccordionTrigger>
        <AccordionContent className="pb-3">
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={cn(
                'text-[10px]',
                result.triageResult.status === 'RELEVANT'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-400',
              )}>
                {result.triageResult.status}
              </Badge>
              <Badge className={cn(
                'text-[10px]',
                result.triageResult.worthResearch
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-gray-500/30 bg-gray-500/10 text-gray-500',
              )}>
                {result.triageResult.worthResearch ? 'Worth Research' : 'Skip Research'}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-gray-300">{result.triageResult.reason}</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Research Agent Outputs */}
      {result.bullOutput && (
        <AccordionItem value="bull" className="border-gray-800">
          <AccordionTrigger className="py-2 text-xs font-medium text-gray-300 hover:no-underline">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3 w-3 text-emerald-400" />
              Bull Case Agent
              <span className="text-[10px] text-gray-600">
                est. {(result.bullOutput.estimatedProbability * 100).toFixed(1)}% | conf {(result.bullOutput.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-3">
              <p className="text-xs leading-relaxed text-gray-300">{result.bullOutput.thesis}</p>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-1">Key Arguments</p>
                <ul className="space-y-1">
                  {result.bullOutput.keyArguments.map((arg, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-gray-400">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                      {arg}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {result.bearOutput && (
        <AccordionItem value="bear" className="border-gray-800">
          <AccordionTrigger className="py-2 text-xs font-medium text-gray-300 hover:no-underline">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3 w-3 text-red-400 rotate-180" />
              Bear Case Agent
              <span className="text-[10px] text-gray-600">
                est. {(result.bearOutput.estimatedProbability * 100).toFixed(1)}% | conf {(result.bearOutput.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-3">
              <p className="text-xs leading-relaxed text-gray-300">{result.bearOutput.thesis}</p>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-1">Key Arguments</p>
                <ul className="space-y-1">
                  {result.bearOutput.keyArguments.map((arg, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-gray-400">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                      {arg}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {result.contradictionOutput && (
        <AccordionItem value="contradiction" className="border-gray-800">
          <AccordionTrigger className="py-2 text-xs font-medium text-gray-300 hover:no-underline">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3 w-3 text-amber-400" />
              Contradiction Agent
              <span className="text-[10px] text-gray-600">
                reliability {(result.contradictionOutput.reliabilityAssessment * 100).toFixed(0)}%
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-1">Contradictions Found</p>
                <ul className="space-y-1">
                  {result.contradictionOutput.contradictions.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-gray-400">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-1">Overlooked Risks</p>
                <ul className="space-y-1">
                  {result.contradictionOutput.overlookedRisks.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-gray-400">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gray-500" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Judge Output */}
      {result.judgeOutput && (
        <AccordionItem value="judge" className="border-gray-800">
          <AccordionTrigger className="py-2 text-xs font-medium text-gray-300 hover:no-underline">
            <div className="flex items-center gap-2">
              <Scale className="h-3 w-3 text-emerald-400" />
              Judge Agent Output
              <span className="text-[10px] text-gray-600">
                P={((result.judgeOutput.trueProbability) * 100).toFixed(1)}%
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-3">
              {result.judgeOutput.skipReason && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
                  <p className="text-[10px] font-medium text-amber-400">Skip Reason</p>
                  <p className="text-xs text-gray-400">{result.judgeOutput.skipReason}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'True Probability', value: `${(result.judgeOutput.trueProbability * 100).toFixed(1)}%` },
                  { label: 'Confidence', value: `${(result.judgeOutput.confidence * 100).toFixed(1)}%` },
                  { label: 'Uncertainty', value: `${(result.judgeOutput.uncertainty * 100).toFixed(1)}%` },
                  { label: 'Catalyst', value: result.judgeOutput.catalystTiming },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2">
                    <p className="text-[10px] text-gray-500">{s.label}</p>
                    <p className="text-sm font-bold text-gray-200">{s.value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-1">Pro Evidence</p>
                <ul className="space-y-1">
                  {result.judgeOutput.proEvidence.map((e, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-emerald-400/80">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500 mb-1">Anti Evidence</p>
                <ul className="space-y-1">
                  {result.judgeOutput.antiEvidence.map((e, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-red-400/80">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                      {e}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Risk Engine Result */}
      {result.riskResult && (
        <AccordionItem value="risk" className="border-gray-800">
          <AccordionTrigger className="py-2 text-xs font-medium text-gray-300 hover:no-underline">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-3 w-3 text-red-400" />
              Risk Engine (Deterministic)
              <Badge className={cn(
                'text-[10px]',
                result.riskResult.action === 'BUY'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-400',
              )}>
                {result.riskResult.action}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className={cn(
              'rounded-lg border p-3',
              result.riskResult.action === 'BUY'
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-red-500/20 bg-red-500/5',
            )}>
              <p className="text-xs leading-relaxed text-gray-300 mb-3">{result.riskResult.reason}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Edge', value: `${(result.riskResult.edge * 100).toFixed(2)}%` },
                  { label: 'Urgency', value: result.riskResult.urgency },
                  { label: 'Max Size', value: `$${result.riskResult.maxSize.toFixed(2)}` },
                  { label: 'Side', value: result.riskResult.side ?? 'N/A' },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2">
                    <p className="text-[10px] text-gray-500">{s.label}</p>
                    <p className="text-sm font-bold text-gray-200">{s.value}</p>
                  </div>
                ))}
              </div>
              {result.riskResult.reasonCode && (
                <p className="mt-2 text-[10px] text-gray-600">
                  Reason code: {result.riskResult.reasonCode}
                </p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {/* Simulated Order */}
      {result.simulatedOrder && (
        <AccordionItem value="order" className="border-gray-800">
          <AccordionTrigger className="py-2 text-xs font-medium text-gray-300 hover:no-underline">
            <div className="flex items-center gap-2">
              <Zap className="h-3 w-3 text-cyan-400" />
              Simulated Order
              <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-[10px]">
                DRY-RUN
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Side', value: result.simulatedOrder.side },
                  { label: 'Price', value: `${(result.simulatedOrder.price * 100).toFixed(1)}` },
                  { label: 'Size', value: `$${result.simulatedOrder.size.toFixed(2)}` },
                  {
                    label: 'Est. PnL',
                    value: `${result.simulatedOrder.estimatedPnl >= 0 ? '+' : ''}$${result.simulatedOrder.estimatedPnl.toFixed(2)}`,
                  },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2">
                    <p className="text-[10px] text-gray-500">{s.label}</p>
                    <p className={cn(
                      'text-sm font-bold',
                      s.label === 'Est. PnL'
                        ? result.simulatedOrder.estimatedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                        : 'text-gray-200',
                    )}>
                      {s.value}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                <p className="text-[11px] text-amber-400/80">
                  <FileText className="mr-1 inline h-3 w-3" />
                  This order was simulated and NOT sent to any exchange. No real funds were used.
                </p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );
}
