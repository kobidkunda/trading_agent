'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  Shield,
  AlertTriangle,
  Save,
  Loader2,
  RotateCcw,
  Cpu,
  RefreshCw,
  Route,
  Brain,
  Search,
  Database,
  Layers,
  Newspaper,
  MessageSquare,
  TrendingUp,
  FileText,
  Activity,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTradingStore } from '@/store/trading-store';
import { VENUE_OPTIONS, CATEGORY_OPTIONS } from '@/lib/constants';
import { DEFAULT_STRATEGY, DEFAULT_STAGE_ROUTING } from '@/lib/engine/risk';
import { syncTradingModeFromBackend } from '@/lib/engine/trading-mode-client';
import { getModeDisplayCopy } from '@/lib/engine/trading-view-model';
import type { StrategySettings, Venue, StageServiceMapping, ResearchDepth, MetadataOption, TradingAgentsMetadataResponse } from '@/lib/types';
import { withStaleOption } from '@/lib/engine/research/transparency';

// ── helpers ──────────────────────────────────────────────────────────────────

function formatPercent(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
function formatDollar(v: number) {
  return `$${v.toLocaleString()}`;
}

const PROMPT_ROLES = [
  'triage',
  'bull',
  'bear',
  'contradiction',
  'judge',
  'postmortem',
] as const;

const STAGE_MODEL_ROLES = [
  { key: 'triageModel' as const, label: 'Triage', desc: 'Market scanning & classification', icon: Cpu },
  { key: 'bullModel' as const, label: 'Bull Advocate', desc: 'Bullish case for trades', icon: Cpu },
  { key: 'bearModel' as const, label: 'Bear Advocate', desc: 'Bearish case for trades', icon: Cpu },
  { key: 'contradictionModel' as const, label: 'Contradiction', desc: 'Find counter-evidence', icon: Cpu },
  { key: 'judgeModel' as const, label: 'Judge', desc: 'Final probability estimate', icon: Cpu },
  { key: 'deerflowModel' as const, label: 'DeerFlow Research', desc: 'Deep multi-hop research agent', icon: Brain },
  { key: 'newsAnalystModel' as const, label: 'News Analyst', desc: 'News analysis via TradingAgents', icon: Newspaper },
  { key: 'sentimentAnalystModel' as const, label: 'Sentiment Analyst', desc: 'Social sentiment via TradingAgents', icon: MessageSquare },
  { key: 'technicalAnalystModel' as const, label: 'Technical Analyst', desc: 'Technical indicators via TradingAgents', icon: TrendingUp },
  { key: 'mirofishPredictionModel' as const, label: 'MiroFish Predict', desc: 'Post-debate synthesis', icon: Brain },
] as const;

const RESEARCH_DEPTH_OPTIONS: { value: ResearchDepth; label: string; desc: string }[] = [
  { value: 'QUICK', label: 'Quick', desc: 'Single search, minimal extraction' },
  { value: 'DEEP', label: 'Deep', desc: 'Multi-source search + extraction' },
  { value: 'DEERFLOW', label: 'DeerFlow', desc: 'Iterative multi-hop deep research' },
  { value: 'FULL', label: 'Full', desc: 'All sources parallel + merge & compare synthesis' },
];

const ORDERBOOK_PENALTY_OPTIONS = [
  { value: 'STRICT', label: 'Strict', desc: 'Missing or weak book data strongly penalized' },
  { value: 'BALANCED', label: 'Balanced', desc: 'Missing book data penalized, but less harshly' },
  { value: 'LENIENT', label: 'Lenient', desc: 'Missing book data mostly neutral; let triage decide' },
] as const;

function getTradingAgentsSourceLabel(source: TradingAgentsMetadataResponse['source'] | null): string {
  switch (source) {
    case 'tradingagents':
      return 'Options loaded from TradingAgents';
    case 'llm-fallback':
      return 'Options loaded from LLM Provider fallback';
    default:
      return 'Metadata unavailable';
  }
}

// ── component ────────────────────────────────────────────────────────────────

export function StrategyHub() {
  const { tradingMode, setTradingMode } = useTradingStore();
  const [settings, setSettings] = useState<StrategySettings>(DEFAULT_STRATEGY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchSettings() {
      try {
        const res = await fetch('/api/strategy');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setTradingMode(data.mode ?? 'PAPER');
          // Merge with defaults to ensure all fields exist
          setSettings({
            ...DEFAULT_STRATEGY,
            ...data,
            stageRouting: {
              ...DEFAULT_STAGE_ROUTING,
              ...(data.stageRouting || {}),
            },
            promptVersion: {
              ...DEFAULT_STRATEGY.promptVersion,
              ...(data.promptVersion || {}),
            },
          });
        }
      } catch {
        toast.error('Failed to load strategy settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    try {
      const responseBody = {
        ...settings,
        mode: tradingMode,
      };

      const res = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responseBody),
      });
      if (res.ok) {
        await syncTradingModeFromBackend();
        toast.success('Strategy settings saved');
      } else {
        toast.error('Failed to save settings');
      }
    } catch {
      toast.error('Network error — settings saved locally');
    } finally {
      setSaving(false);
    }
  }, [settings, tradingMode, setTradingMode]);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_STRATEGY);
    setTradingMode('PAPER');
    toast.info('Settings reset to defaults');
  }, [setTradingMode]);

  const modeCopy = getModeDisplayCopy(tradingMode);

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [deerflowApiModels, setDeerflowApiModels] = useState<string[]>([]);
  const [deerflowError, setDeerflowError] = useState<string | null>(null);
  const [deerflowLoading, setDeerflowLoading] = useState(false);

  // TradingAgents metadata state
  const [tradingAgentsProviders, setTradingAgentsProviders] = useState<MetadataOption[]>([]);
  const [tradingAgentsModels, setTradingAgentsModels] = useState<MetadataOption[]>([]);
  const [tradingAgentsSource, setTradingAgentsSource] = useState<TradingAgentsMetadataResponse['source'] | null>(null);
  const [tradingAgentsError, setTradingAgentsError] = useState<string | null>(null);
  const [tradingAgentsLoading, setTradingAgentsLoading] = useState(false);

  // MiroFish state
  const [mirofishModels, setMirofishModels] = useState<Array<{id: string; tier: string; provider: string; isFree: boolean}>>([]);
  const [mirofishLoading, setMirofishLoading] = useState(false);
  const [mirofishError, setMirofishError] = useState<string | null>(null);

  // Service health state
  const [serviceHealth, setServiceHealth] = useState<Record<string, string>>({});

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetch('/api/llm/models');
      if (res.ok) {
        const data = await res.json();
        setAvailableModels(data.models.map((m: { id: string }) => m.id));
        if (data.error) setModelsError(data.error);
      } else {
        setModelsError('Failed to fetch models');
      }
    } catch {
      setModelsError('Network error');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Fetch MiroFish models
  useEffect(() => {
    let cancelled = false;
    async function fetchMirofish() {
      setMirofishLoading(true);
      setMirofishError(null);
      try {
        const res = await fetch('/api/mirofish/models');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setMirofishModels(data.models || []);
          if (data.error) setMirofishError(data.error);
        } else if (!cancelled) {
          setMirofishError(`Failed: HTTP ${res.status}`);
        }
      } catch (e) {
        if (!cancelled) setMirofishError(String(e));
      } finally {
        if (!cancelled) setMirofishLoading(false);
      }
    }
    fetchMirofish();
    return () => { cancelled = true; };
  }, []);

  // Fetch service health
  useEffect(() => {
    let cancelled = false;
    async function fetchHealth() {
      try {
        const res = await fetch('/api/health');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setServiceHealth(data.apiHealth || {});
        }
      } catch {}
    }
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchDeerFlowApiModels() {
      setDeerflowLoading(true);
      setDeerflowError(null);
      try {
        const res = await fetch('/api/deerflow/models');
        if (!res.ok) {
          if (!cancelled) {
            setDeerflowError(`Failed to fetch DeerFlow models: HTTP ${res.status}`);
          }
          return;
        }

        const data = await res.json();
        if (!cancelled) {
          setDeerflowApiModels(Array.isArray(data.models) ? data.models.filter((model: unknown): model is string => typeof model === 'string' && model.length > 0) : []);
          if (data.error) {
            setDeerflowError(data.error);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setDeerflowApiModels([]);
          setDeerflowError(error instanceof Error ? error.message : 'Failed to connect to DeerFlow service');
        }
      } finally {
        if (!cancelled) {
          setDeerflowLoading(false);
        }
      }
    }

    fetchDeerFlowApiModels();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch TradingAgents metadata
  useEffect(() => {
    let cancelled = false;

    async function fetchTradingAgentsModels() {
      setTradingAgentsLoading(true);
      setTradingAgentsError(null);
      try {
        const res = await fetch('/api/tradingagents/models');
        if (!res.ok) {
          if (!cancelled) {
            setTradingAgentsProviders([]);
            setTradingAgentsModels([]);
            setTradingAgentsSource('llm-fallback');
            setTradingAgentsError(`Failed to fetch: HTTP ${res.status}`);
          }
          return;
        }

        const data: TradingAgentsMetadataResponse = await res.json();
        if (!cancelled) {
          // Use withStaleOption to preserve saved values if not in current list
          const savedProvider = settings.stageRouting?.analystLlmProvider;
          const savedDeepModel = settings.stageRouting?.analystDeepThinkLlm;
          const savedQuickModel = settings.stageRouting?.analystQuickThinkLlm;

          const providersWithStale = withStaleOption(data.providers, savedProvider);
          const modelsWithStale = withStaleOption(
            data.models,
            savedDeepModel || savedQuickModel || null
          );

          setTradingAgentsProviders(providersWithStale);
          setTradingAgentsModels(modelsWithStale);
          setTradingAgentsSource(data.source);
          setTradingAgentsError(data.error || null);
        }
      } catch (e) {
        if (!cancelled) {
          setTradingAgentsProviders([]);
          setTradingAgentsModels([]);
          setTradingAgentsSource('llm-fallback');
          setTradingAgentsError(e instanceof Error ? e.message : 'Network error');
        }
      } finally {
        if (!cancelled) setTradingAgentsLoading(false);
      }
    }

    fetchTradingAgentsModels();
    return () => {
      cancelled = true;
    };
    // Refetch when relevant settings change to update stale options
  }, [settings.stageRouting?.analystLlmProvider, settings.stageRouting?.analystDeepThinkLlm, settings.stageRouting?.analystQuickThinkLlm]);

  // ── updaters ─────────────────────────────────────────────────────────────
  const toggleVenue = (venue: Venue) => {
    setSettings((s) => ({
      ...s,
      enabledVenues: s.enabledVenues.includes(venue)
        ? s.enabledVenues.filter((v) => v !== venue)
        : [...s.enabledVenues, venue],
    }));
  };

  const toggleCategory = (cat: string) => {
    setSettings((s) => ({
      ...s,
      enabledCategories: s.enabledCategories.includes(cat)
        ? s.enabledCategories.filter((c) => c !== cat)
        : [...s.enabledCategories, cat],
    }));
  };

  const updateNumber = (key: keyof StrategySettings, val: number) => {
    setSettings((s) => ({ ...s, [key]: val }));
  };

  const updateStageRouting = (
    key: keyof StageServiceMapping,
    val: string | number | boolean
  ) => {
    setSettings((s) => ({
      ...s,
      stageRouting: { ...(s.stageRouting || DEFAULT_STAGE_ROUTING), [key]: val },
    }));
  };

  const updatePromptVersion = (role: string, version: number) => {
    setSettings((s) => ({
      ...s,
      promptVersion: { ...s.promptVersion, [role]: version },
    }));
  };

  // ── loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Strategy Hub</h2>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-xl bg-gray-900"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Strategy Hub</h2>
          <p className="mt-1 text-sm text-gray-500">
            Configure trading venues, risk parameters, and agent behavior
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={resetSettings}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={saveSettings}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Settings
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ─── Venue Selection ─── */}
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Building2 className="h-4 w-4 text-emerald-400" />
              Venue Selection
            </CardTitle>
            <CardDescription className="text-gray-500">
              Enable prediction market venues for scanning
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {VENUE_OPTIONS.map((venue) => {
              const enabled = settings.enabledVenues.includes(
                venue.value as Venue
              );
              return (
                <div
                  key={venue.value}
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/40 px-4 py-3 transition-colors hover:bg-gray-800/60"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: venue.color }}
                    />
                    <span className="text-sm font-medium text-gray-200">
                      {venue.label}
                    </span>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={() => toggleVenue(venue.value as Venue)}
                  />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* ─── Category Filters ─── */}
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Shield className="h-4 w-4 text-emerald-400" />
              Category Filters
            </CardTitle>
            <CardDescription className="text-gray-500">
              Filter markets by category
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CATEGORY_OPTIONS.map((cat) => {
                const enabled = settings.enabledCategories.includes(cat);
                return (
                  <label
                    key={cat}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                      enabled
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-gray-800 bg-gray-800/40 text-gray-400 hover:border-gray-700'
                    )}
                  >
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={() => toggleCategory(cat)}
                      className="data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500"
                    />
                    <span className="capitalize">{cat}</span>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ─── Risk Parameters ─── */}
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Risk Parameters
            </CardTitle>
            <CardDescription className="text-gray-500">
              Fine-tune risk thresholds and position sizing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Min Liquidity */}
            <RiskSliderRow
              label="Min Liquidity"
              help="Minimum market depth required before bot considers trade. Higher means safer but fewer trades."
              value={settings.minLiquidity}
              min={100}
              max={50000}
              step={100}
              format={(v) => formatDollar(v)}
              onChange={(v) => updateNumber('minLiquidity', v)}
            />

            {/* Target Edge */}
            <RiskSliderRow
              label="Target Edge"
              help="Minimum advantage bot wants over market price. Higher means only stronger setups pass."
              value={settings.targetEdge}
              min={0.01}
              max={0.30}
              step={0.005}
              format={(v) => formatPercent(v)}
              onChange={(v) => updateNumber('targetEdge', v)}
            />

            {/* Max Spread */}
            <RiskSliderRow
              label="Max Spread"
              help="Widest bid/ask gap bot will tolerate. Lower means better execution quality."
              value={settings.maxSpread}
              min={0.005}
              max={0.15}
              step={0.005}
              format={(v) => formatPercent(v)}
              onChange={(v) => updateNumber('maxSpread', v)}
            />

            <Separator className="bg-gray-800" />

            {/* Exposure Limits */}
            <RiskSliderRow
              label="Max Exposure / Market"
              help="Largest amount bot can risk on one single market."
              value={settings.maxExposurePerMarket}
              min={100}
              max={25000}
              step={100}
              format={(v) => formatDollar(v)}
              onChange={(v) => updateNumber('maxExposurePerMarket', v)}
            />

            <RiskSliderRow
              label="Max Daily Exposure"
              help="Total amount bot can put at risk across all trades in one day."
              value={settings.maxDailyExposure}
              min={1000}
              max={200000}
              step={1000}
              format={(v) => formatDollar(v)}
              onChange={(v) => updateNumber('maxDailyExposure', v)}
            />

            <RiskSliderRow
              label="Max Category Exposure"
              help="Maximum total risk allowed in one category like sports or politics."
              value={settings.maxCategoryExposure}
              min={500}
              max={50000}
              step={500}
              format={(v) => formatDollar(v)}
              onChange={(v) => updateNumber('maxCategoryExposure', v)}
            />

            <Separator className="bg-gray-800" />

            <div className="space-y-3">
              <div>
                <Label className="text-sm text-gray-300">Orderbook Penalty Mode</Label>
                <p className="mt-1 text-xs text-gray-500">
                  Controls how hard missing or low-quality orderbook data hurts candidate score.
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  Strict = block more weak markets. Balanced = softer penalty. Lenient = let more markets reach triage even if book data is incomplete.
                </p>
              </div>
              <div className="grid gap-2">
                {ORDERBOOK_PENALTY_OPTIONS.map((option) => {
                  const active = (settings.orderbookPenaltyMode || 'STRICT') === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSettings((s) => ({ ...s, orderbookPenaltyMode: option.value }))}
                      className={cn(
                        'rounded-lg border px-3 py-3 text-left transition-colors',
                        active
                          ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                          : 'border-gray-800 bg-gray-800/40 text-gray-400 hover:border-gray-700',
                      )}
                    >
                      <div className="text-sm font-medium">{option.label}</div>
                      <div className="mt-1 text-xs text-gray-500">{option.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <RiskSliderRow
              label="Missing Orderbook Penalty"
              help="Exact score penalty used when orderbook data is missing. Lower means more markets reach triage."
              value={settings.missingOrderbookPenalty ?? 15}
              min={0}
              max={15}
              step={1}
              format={(v) => `${v.toFixed(0)} pts`}
              onChange={(v) => updateNumber('missingOrderbookPenalty', v)}
            />
          </CardContent>
        </Card>

        {/* ─── Research Settings ─── */}
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <FileText className="h-4 w-4 text-emerald-400" />
              Research Settings
            </CardTitle>
            <CardDescription className="text-gray-500">
              Configure research escalation and prompt versions
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Escalation Threshold */}
            <RiskSliderRow
              label="Research Escalation Threshold"
              value={settings.researchEscalationThreshold}
              min={0.01}
              max={0.25}
              step={0.005}
              format={(v) => formatPercent(v)}
              onChange={(v) => updateNumber('researchEscalationThreshold', v)}
            />

            <Separator className="bg-gray-800" />

            {/* Prompt version dropdowns */}
            <div className="space-y-3">
              <Label className="text-sm font-medium text-gray-300">
                Prompt Versions per Agent
              </Label>
              {PROMPT_ROLES.map((role) => (
                <div
                  key={role}
                  className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/40 px-4 py-2.5"
                >
                  <span className="text-sm capitalize text-gray-300">
                    {role}
                  </span>
                  <Select
                    value={String(settings.promptVersion?.[role] ?? 1)}
                    onValueChange={(v) =>
                      updatePromptVersion(role, Number(v))
                    }
                  >
                    <SelectTrigger className="w-24 border-gray-700 bg-gray-800 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-gray-700 bg-gray-900">
                      <SelectItem value="1">v1</SelectItem>
                      <SelectItem value="2">v2</SelectItem>
                      <SelectItem value="3">v3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>



       {/* ─── Model Configuration ─── */}
       <Card className="border-gray-800 bg-gray-900">
         <CardHeader className="pb-3">
           <div className="flex items-center justify-between">
             <div>
               <CardTitle className="flex items-center gap-2 text-base text-white">
                 <Cpu className="h-4 w-4 text-cyan-400" />
                 Default Model
               </CardTitle>
               <CardDescription className="text-gray-500">
                 Fallback model for all agents when stage-specific model is not set
               </CardDescription>
             </div>
             <Button
               variant="ghost"
               size="sm"
               className="h-7 gap-1.5 text-[11px] text-gray-400"
               onClick={fetchModels}
               disabled={modelsLoading}
             >
               {modelsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
               Refresh
             </Button>
           </div>
         </CardHeader>
         <CardContent className="space-y-3">
           {modelsError && (
             <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">
               <AlertTriangle className="h-3 w-3 shrink-0" />
               {modelsError}
             </div>
           )}

           {availableModels.length === 0 && !modelsLoading && !modelsError && (
             <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
               <Cpu className="h-3 w-3 shrink-0" />
               No models found — ensure your LLM Provider credential is configured and tested
             </div>
           )}

           <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-800/40 px-4 py-2.5">
             <div className="min-w-0">
               <p className="text-sm text-gray-300">Default Fallback Model</p>
               <p className="text-[10px] text-gray-600">Used when no stage-specific model is configured</p>
             </div>
             <div className="flex items-center gap-2 shrink-0">
               <Select
                 value={settings.defaultModel || ''}
                 onValueChange={(v) => setSettings((s) => ({ ...s, defaultModel: v || undefined }))}
               >
                   <SelectTrigger className="w-52 border-gray-700 bg-gray-800 text-white text-xs">
                     <SelectValue placeholder="paper_lite" />
                   </SelectTrigger>
                     <SelectContent className="border-gray-700 bg-gray-900 max-h-64">
                       {availableModels.map((modelId) => (
                             <SelectItem key={modelId} value={modelId} className="text-xs font-mono">
                               {modelId}
                             </SelectItem>
                           ))
                       }
                     </SelectContent>
                 </Select>
              </div>
            </div>

            <p className="text-[10px] text-gray-600">
              Stage-specific model assignment is configured in the Service-to-Stage Routing card above.
           </p>
         </CardContent>
       </Card>

       {/* ─── Stage Service Routing ─── */}
       <Card className="border-gray-800 bg-gray-900">
         <CardHeader className="pb-3">
           <CardTitle className="flex items-center gap-2 text-base text-white">
             <Route className="h-4 w-4 text-violet-400" />
             Service-to-Stage Routing
           </CardTitle>
           <CardDescription className="text-gray-500">
             Assign which LLM model and service each pipeline stage uses
           </CardDescription>
         </CardHeader>
         <CardContent className="space-y-3">
           {STAGE_MODEL_ROLES.map(({ key, label, desc, icon: Icon }) => (
             <div
               key={key}
               className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-800/40 px-4 py-2.5"
             >
               <div className="flex items-center gap-3 min-w-0">
                 <Icon className="h-4 w-4 shrink-0 text-gray-500" />
                 <div className="min-w-0">
                   <p className="text-sm text-gray-300">{label}</p>
                   <p className="text-[10px] text-gray-600">{desc}</p>
                 </div>
               </div>
               <div className="flex items-center gap-2 shrink-0">
                 {settings.stageRouting?.[key] && (
                   <button
                     onClick={() => updateStageRouting(key, '')}
                     className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors"
                   >
                     clear
                   </button>
                 )}
                 <Select
                   value={settings.stageRouting?.[key] || ''}
                   onValueChange={(v) => updateStageRouting(key, v)}
                 >
                   <SelectTrigger className="w-52 border-gray-700 bg-gray-800 text-white text-xs">
                     <SelectValue placeholder="Use default" />
                   </SelectTrigger>
                    <SelectContent className="border-gray-700 bg-gray-900 max-h-64">
                      {key === 'mirofishPredictionModel'
                        ? mirofishModels.map((m) => (
                            <SelectItem key={m.id} value={m.id} className="text-xs">
                              <span className="font-mono">{m.id}</span>
                              <Badge variant="outline" className={`ml-2 text-[9px] px-1 py-0 ${
                                m.isFree ? 'border-emerald-700 text-emerald-400' : 'border-amber-700 text-amber-400'
                              }`}>{m.tier}</Badge>
                            </SelectItem>
                          ))
                        : availableModels.map((modelId) => (
                            <SelectItem key={modelId} value={modelId} className="text-xs font-mono">
                              {modelId}
                            </SelectItem>
                          ))
                      }
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
             <Separator className="bg-gray-800" />
            {/* Service Usage Info */}
            <div className="rounded-lg border border-gray-700 bg-gray-800/20 p-3 space-y-2">
              <p className="text-[11px] font-medium text-gray-400">Services each stage uses:</p>
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <Cpu className="h-3 w-3" />
                <span>LLM Provider credential for triage, bull, bear, contradiction, judge</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <Search className="h-3 w-3" />
                <span>SearXNG credential for web search (all depths)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <Brain className="h-3 w-3" />
                <span>DeerFlow credential for deep research (or falls back to LLM Provider)</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <Database className="h-3 w-3" />
                <span>Qdrant credential for research memory</span>
              </div>
              <p className="text-[10px] text-gray-600">Configure credentials on the Credentials page. Add a "DeerFlow Research" credential to use a separate LLM for deep research.</p>
            </div>
            {/* Research Providers Health */}
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-4 py-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-300">Research Providers</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { key: 'deerflow', label: 'DeerFlow', fallback: 'Firecrawl' },
                  { key: 'firecrawl', label: 'Firecrawl', fallback: null },
                  { key: 'mirofis', label: 'MiroFish', fallback: null },
                ].map(({ key, label, fallback }) => {
                  const status = serviceHealth[key] || 'UNKNOWN';
                  const color = status === 'UP' ? 'bg-emerald-500' : status === 'DOWN' ? 'bg-red-500' : 'bg-gray-500';
                  return (
                    <div key={key} className="flex items-center justify-between rounded bg-gray-800/60 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${color}`} />
                        <span className="text-xs text-gray-300">{label}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {status === 'DOWN' && fallback ? (
                          <span className="text-[10px] text-amber-400">→ {fallback}</span>
                        ) : null}
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                          status === 'UP' ? 'border-emerald-700 text-emerald-400' :
                          status === 'DOWN' ? 'border-red-700 text-red-400' :
                          'border-gray-600 text-gray-400'
                        }`}>{status}</Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
             {/* Agent-Reach Controls */}
             <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-4 py-3 space-y-3">
               <div className="flex items-center justify-between gap-3">
                 <div className="flex items-center gap-3 min-w-0">
                   <Search className="h-4 w-4 shrink-0 text-gray-500" />
                   <div className="min-w-0">
                     <p className="text-sm text-gray-300">Agent-Reach</p>
                     <p className="text-[10px] text-gray-600">Optional remote research adapter for external evidence gathering</p>
                   </div>
                 </div>
                 <Switch
                   checked={Boolean(settings.stageRouting?.agentReachEnabled)}
                   onCheckedChange={(checked) => updateStageRouting('agentReachEnabled', checked)}
                 />
               </div>
               <div className="grid gap-3 sm:grid-cols-2">
                 <div className="space-y-1">
                   <Label className="text-[11px] text-gray-400">Service URL</Label>
                   <Input
                     value={settings.stageRouting?.agentReachServiceUrl || ''}
                     onChange={(e) => updateStageRouting('agentReachServiceUrl', e.target.value)}
                     placeholder="http://localhost:8200"
                     className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                   />
                 </div>
                 <div className="space-y-1">
                   <Label className="text-[11px] text-gray-400">Tool Name</Label>
                   <Input
                     value={settings.stageRouting?.agentReachToolName || ''}
                     onChange={(e) => updateStageRouting('agentReachToolName', e.target.value)}
                     placeholder="research"
                     className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                   />
                 </div>
               </div>
             </div>
             {/* Vector DB Collection Override */}
             <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-800/40 px-4 py-2.5">
               <div className="flex items-center gap-3 min-w-0">
                 <Database className="h-4 w-4 shrink-0 text-gray-500" />
                 <div className="min-w-0">
                   <p className="text-sm text-gray-300">Vector DB Collection</p>
                   <p className="text-[10px] text-gray-600">Override research memory collection (leave empty for default)</p>
                 </div>
               </div>
               <Input
                 value={settings.stageRouting?.vectorDbCollection || ''}
                 onChange={(e) => updateStageRouting('vectorDbCollection', e.target.value)}
                 placeholder="research_memory"
                 className="h-8 w-48 border-gray-700 bg-gray-800 text-xs text-white"
               />
             </div>

            <p className="text-[10px] text-gray-600">
              Leave model fields empty to fall back to Default, then to &quot;paper_lite&quot;. All services use credentials from the Credentials page.
            </p>
         </CardContent>
       </Card>

       {/* ─── Research Depth & DeerFlow ─── */}
       <Card className="border-gray-800 bg-gray-900">
         <CardHeader className="pb-3">
           <CardTitle className="flex items-center gap-2 text-base text-white">
             <Layers className="h-4 w-4 text-amber-400" />
             Research Depth
           </CardTitle>
           <CardDescription className="text-gray-500">
             Choose how deeply the pipeline researches each market
           </CardDescription>
         </CardHeader>
         <CardContent className="space-y-4">
           {/* Research Depth */}
           <div className="space-y-2">
             <Label className="text-sm font-medium text-gray-300">Research Depth</Label>
             <div className="grid grid-cols-3 gap-3">
               {RESEARCH_DEPTH_OPTIONS.map((opt) => (
                 <button
                   key={opt.value}
                   onClick={() => updateStageRouting('researchDepth', opt.value)}
                   className={cn(
                     'flex flex-col items-center gap-1 rounded-lg border p-3 transition-colors',
                     (settings.stageRouting?.researchDepth || 'DEEP') === opt.value
                       ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                       : 'border-gray-800 bg-gray-800/40 text-gray-400 hover:border-gray-700'
                   )}
                 >
                   <span className="text-sm font-medium">{opt.label}</span>
                   <span className="text-[10px]">{opt.desc}</span>
                 </button>
               ))}
             </div>
              {['DEERFLOW', 'FULL'].includes(settings.stageRouting?.researchDepth || 'DEEP') && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300">
                  DeerFlow uses your LLM Provider and SearXNG credentials. FULL depth also runs TradingAgents in parallel and merges the provider outputs.
                </div>
              )}
            </div>

            {/* DeerFlow and TradingAgents settings for DEERFLOW/FULL research */}
            {['DEERFLOW', 'FULL'].includes(settings.stageRouting?.researchDepth || 'DEEP') && (

             <>
               <Separator className="bg-gray-800" />
               <div className="space-y-3">
                 <Label className="text-sm font-medium text-gray-300">DeerFlow Parameters</Label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-gray-400">Search Iterations</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={settings.stageRouting?.deerflowSearchIterations ?? 3}
                      onChange={(e) => updateStageRouting('deerflowSearchIterations', Number(e.target.value))}
                      className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-gray-400">Questions per Iteration</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={settings.stageRouting?.deerflowQuestionsPerIteration ?? 3}
                      onChange={(e) => updateStageRouting('deerflowQuestionsPerIteration', Number(e.target.value))}
                      className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-gray-400">Max Depth</Label>
                    <Input
                      type="number"
                      min={1}
                      max={5}
                      value={settings.stageRouting?.deerflowMaxDepth ?? 3}
                      onChange={(e) => updateStageRouting('deerflowMaxDepth', Number(e.target.value))}
                      className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] text-gray-400">DeerFlow API Model</Label>
                    {deerflowLoading && <Loader2 className="h-3 w-3 animate-spin text-gray-500" />}
                  </div>
                  
                  {/* DeerFlow Error Display */}
                  {deerflowError && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span className="truncate">{deerflowError}</span>
                    </div>
                  )}
                  {(() => {
                    // Convert deerflowApiModels to MetadataOption[] and apply withStaleOption
                    const deerflowOptions: MetadataOption[] = deerflowApiModels.map((id) => ({ id, label: id }));
                    const savedDeerflowModel = settings.stageRouting?.deerflowApiModel;
                    const deerflowOptionsWithStale = withStaleOption(deerflowOptions, savedDeerflowModel);

                    return deerflowOptionsWithStale.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <Select
                          value={settings.stageRouting?.deerflowApiModel || ''}
                          onValueChange={(value) => updateStageRouting('deerflowApiModel', value)}
                        >
                          <SelectTrigger className="h-8 w-full border-gray-700 bg-gray-800 text-xs text-white">
                            <SelectValue placeholder="Use DeerFlow service default" />
                          </SelectTrigger>
                          <SelectContent className="border-gray-700 bg-gray-900 max-h-64">
                            {deerflowOptionsWithStale.map((model) => (
                              <SelectItem
                                key={model.id}
                                value={model.id}
                                className={`text-xs font-mono ${model.stale ? 'text-amber-400' : ''}`}
                              >
                                {model.label}
                                {model.stale && ' (stale)'}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {settings.stageRouting?.deerflowApiModel && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-[11px] text-gray-400 hover:text-gray-200"
                            onClick={() => updateStageRouting('deerflowApiModel', '')}
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Input
                        value={settings.stageRouting?.deerflowApiModel || ''}
                        onChange={(e) => updateStageRouting('deerflowApiModel', e.target.value)}
                        placeholder="Use DeerFlow service default"
                        className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                      />
                    );
                  })()}
                  <p className="text-[10px] text-gray-600">
                    {deerflowApiModels.length > 0
                      ? 'Optional override for DeerFlow API runs.'
                      : 'Model list unavailable. Leave empty to use the DeerFlow service default, or enter a model manually.'}
                  </p>
                </div>
                <p className="text-[10px] text-gray-600">
                  More iterations and depth increase research quality but take longer and use more LLM tokens.
                </p>
              </div>


                {/* TradingAgents Config */}
                <Separator className="bg-gray-800" />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium text-gray-300">TradingAgents Analyst Team</Label>
                    {tradingAgentsLoading && <Loader2 className="h-3 w-3 animate-spin text-gray-500" />}
                  </div>
                  <p className="text-[10px] text-gray-600">
                    Multi-source analysts (News, Sentiment, Technical) run in parallel via TradingAgents Docker service.
                  </p>

                  {/* Source label */}
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <Database className="h-3 w-3" />
                    <span>{getTradingAgentsSourceLabel(tradingAgentsSource)}</span>
                  </div>

                  {/* Error display */}
                  {tradingAgentsError && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {tradingAgentsError}
                    </div>
                  )}

                  {/* Dropdowns or manual input fallback */}
                  {tradingAgentsProviders.length === 0 && tradingAgentsModels.length === 0 ? (
                    // Manual input fallback when both arrays are empty
                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-400">LLM Provider</Label>
                        <Input
                          value={settings.stageRouting?.analystLlmProvider || ''}
                          onChange={(e) => updateStageRouting('analystLlmProvider', e.target.value)}
                          placeholder="openai"
                          className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-400">Deep Think Model</Label>
                        <Input
                          value={settings.stageRouting?.analystDeepThinkLlm || ''}
                          onChange={(e) => updateStageRouting('analystDeepThinkLlm', e.target.value)}
                          placeholder="paper_proglm"
                          className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-400">Quick Think Model</Label>
                        <Input
                          value={settings.stageRouting?.analystQuickThinkLlm || ''}
                          onChange={(e) => updateStageRouting('analystQuickThinkLlm', e.target.value)}
                          placeholder="paper_lite"
                          className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-400">Debate Rounds</Label>
                        <Input
                          type="number"
                          min={1}
                          max={5}
                          value={settings.stageRouting?.analystMaxDebateRounds ?? 2}
                          onChange={(e) => updateStageRouting('analystMaxDebateRounds', Number(e.target.value))}
                          className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                        />
                      </div>
                    </div>
                  ) : (
                    // Select dropdowns when metadata is available
                    <div className="grid gap-3 sm:grid-cols-4">
                      {/* LLM Provider dropdown */}
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-400">LLM Provider</Label>
                        <div className="flex items-center gap-2">
                          <Select
                            value={settings.stageRouting?.analystLlmProvider || ''}
                            onValueChange={(v) => updateStageRouting('analystLlmProvider', v)}
                          >
                            <SelectTrigger className="h-8 w-full border-gray-700 bg-gray-800 text-xs text-white">
                              <SelectValue placeholder="Select provider" />
                            </SelectTrigger>
                            <SelectContent className="border-gray-700 bg-gray-900 max-h-64">
                              {tradingAgentsProviders.map((provider) => (
                                <SelectItem
                                  key={provider.id}
                                  value={provider.id}
                                  className={`text-xs font-mono ${provider.stale ? 'text-amber-400' : ''}`}
                                >
                                  {provider.label}
                                  {provider.stale && ' (stale)'}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {settings.stageRouting?.analystLlmProvider && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-[11px] text-gray-400 hover:text-gray-200"
                              onClick={() => updateStageRouting('analystLlmProvider', '')}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Deep Think Model dropdown */}
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-400">Deep Think Model</Label>
                        <div className="flex items-center gap-2">
                          <Select
                            value={settings.stageRouting?.analystDeepThinkLlm || ''}
                            onValueChange={(v) => updateStageRouting('analystDeepThinkLlm', v)}
                          >
                            <SelectTrigger className="h-8 w-full border-gray-700 bg-gray-800 text-xs text-white">
                              <SelectValue placeholder="Select model" />
                            </SelectTrigger>
                            <SelectContent className="border-gray-700 bg-gray-900 max-h-64">
                              {tradingAgentsModels.map((model) => (
                                <SelectItem
                                  key={model.id}
                                  value={model.id}
                                  className={`text-xs font-mono ${model.stale ? 'text-amber-400' : ''}`}
                                >
                                  {model.label}
                                  {model.stale && ' (stale)'}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {settings.stageRouting?.analystDeepThinkLlm && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-[11px] text-gray-400 hover:text-gray-200"
                              onClick={() => updateStageRouting('analystDeepThinkLlm', '')}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Quick Think Model dropdown */}
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-400">Quick Think Model</Label>
                        <div className="flex items-center gap-2">
                          <Select
                            value={settings.stageRouting?.analystQuickThinkLlm || ''}
                            onValueChange={(v) => updateStageRouting('analystQuickThinkLlm', v)}
                          >
                            <SelectTrigger className="h-8 w-full border-gray-700 bg-gray-800 text-xs text-white">
                              <SelectValue placeholder="Select model" />
                            </SelectTrigger>
                            <SelectContent className="border-gray-700 bg-gray-900 max-h-64">
                              {tradingAgentsModels.map((model) => (
                                <SelectItem
                                  key={model.id}
                                  value={model.id}
                                  className={`text-xs font-mono ${model.stale ? 'text-amber-400' : ''}`}
                                >
                                  {model.label}
                                  {model.stale && ' (stale)'}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {settings.stageRouting?.analystQuickThinkLlm && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-[11px] text-gray-400 hover:text-gray-200"
                              onClick={() => updateStageRouting('analystQuickThinkLlm', '')}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Debate Rounds input (unchanged) */}
                      <div className="space-y-1">
                        <Label className="text-[11px] text-gray-400">Debate Rounds</Label>
                        <Input
                          type="number"
                          min={1}
                          max={5}
                          value={settings.stageRouting?.analystMaxDebateRounds ?? 2}
                          onChange={(e) => updateStageRouting('analystMaxDebateRounds', Number(e.target.value))}
                          className="h-8 border-gray-700 bg-gray-800 text-xs text-white"
                        />
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] text-gray-600">
                    Configure the TradingAgents credential on the Credentials page. Models are used by the Python TradingAgents service internally.
                  </p>
                </div>
              </>
            )}
          </CardContent>
       </Card>

       {/* ─── Trading Mode ─── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white">Trading Mode</CardTitle>
           <CardDescription className="text-gray-500">
             Switch between demo, paper, and live trading modes
           </CardDescription>
         </CardHeader>
         <CardContent>
           <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
             <div className="flex items-center gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-4">
               <div
                 className={cn(
                   'flex h-14 w-14 items-center justify-center rounded-full',
                   modeCopy.badgeTone === 'amber'
                     ? 'bg-amber-500/20'
                     : modeCopy.badgeTone === 'red'
                       ? 'bg-red-500/20'
                       : 'bg-emerald-500/20'
                 )}
               >
                 <div
                   className={cn(
                     'h-6 w-6 rounded-full transition-colors',
                     modeCopy.badgeTone === 'amber'
                       ? 'bg-amber-400'
                       : modeCopy.badgeTone === 'red'
                         ? 'bg-red-400'
                         : 'animate-pulse bg-emerald-400'
                   )}
                 />
               </div>
               <div>
                 <p
                   className={cn(
                     'text-lg font-bold',
                     modeCopy.badgeTone === 'amber'
                       ? 'text-amber-400'
                       : modeCopy.badgeTone === 'red'
                         ? 'text-red-400'
                         : 'text-emerald-400'
                   )}
                 >
                   {modeCopy.label}
                 </p>
                 <p className="text-xs text-gray-500">{modeCopy.description}</p>
               </div>
             </div>

             <div className="flex flex-wrap gap-2">
               {(['DEMO', 'PAPER', 'LIVE'] as const).map((modeOption) => {
                 const active = tradingMode === modeOption;
                 return (
                   <Button
                     key={modeOption}
                     type="button"
                     variant="ghost"
                     size="sm"
                     className={cn(
                       'border border-gray-800',
                       active
                         ? modeOption === 'DEMO'
                           ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                           : modeOption === 'LIVE'
                             ? 'bg-red-500/10 text-red-300 border-red-500/30'
                             : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                         : 'text-gray-400 hover:text-white hover:bg-gray-800'
                     )}
                     onClick={() => setTradingMode(modeOption)}
                   >
                     {modeOption}
                   </Button>
                 );
               })}
             </div>

             {tradingMode === 'LIVE' && (
               <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                 <AlertTriangle className="h-4 w-4 text-red-400" />
                 <span className="text-xs font-medium text-red-400">
                   Live execution remains safety-gated until connectors are enabled
                 </span>
               </div>
             )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RiskSliderRow({
  label,
  help,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm text-gray-300">{label}</Label>
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-7 w-28 border-gray-700 bg-gray-800 text-right text-xs text-white"
        />
      </div>
      {help && <p className="text-xs leading-5 text-gray-500">{help}</p>}
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        className="py-1"
      />
      <div className="flex justify-between text-[11px] text-gray-600">
        <span>{format(min)}</span>
        <span className="font-medium text-gray-400">{format(value)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
