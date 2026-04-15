'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Building2,
  Shield,
  AlertTriangle,
  Save,
  Loader2,
  RotateCcw,
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
import { DEFAULT_STRATEGY } from '@/lib/engine/risk';
import type { StrategySettings, Venue } from '@/lib/types';

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

// ── component ────────────────────────────────────────────────────────────────

export function StrategyHub() {
  const { dryRunMode, setDryRunMode } = useTradingStore();
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
          setSettings(data);
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
      const res = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        toast.success('Strategy settings saved');
      } else {
        toast.error('Failed to save settings');
      }
    } catch {
      toast.error('Network error — settings saved locally');
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_STRATEGY);
    setDryRunMode(true);
    toast.info('Settings reset to defaults');
  }, [setDryRunMode]);

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
              value={settings.maxExposurePerMarket}
              min={100}
              max={25000}
              step={100}
              format={(v) => formatDollar(v)}
              onChange={(v) => updateNumber('maxExposurePerMarket', v)}
            />

            <RiskSliderRow
              label="Max Daily Exposure"
              value={settings.maxDailyExposure}
              min={1000}
              max={200000}
              step={1000}
              format={(v) => formatDollar(v)}
              onChange={(v) => updateNumber('maxDailyExposure', v)}
            />

            <RiskSliderRow
              label="Max Category Exposure"
              value={settings.maxCategoryExposure}
              min={500}
              max={50000}
              step={500}
              format={(v) => formatDollar(v)}
              onChange={(v) => updateNumber('maxCategoryExposure', v)}
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
                    value={String(settings.promptVersion[role] ?? 1)}
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

      {/* ─── Trading Mode ─── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white">Trading Mode</CardTitle>
          <CardDescription className="text-gray-500">
            Switch between dry-run simulation and live trading
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-4 rounded-xl border border-gray-800 bg-gray-800/40 p-4">
              <div
                className={cn(
                  'flex h-14 w-14 items-center justify-center rounded-full',
                  dryRunMode ? 'bg-amber-500/20' : 'bg-emerald-500/20'
                )}
              >
                <div
                  className={cn(
                    'h-6 w-6 rounded-full transition-colors',
                    dryRunMode ? 'bg-amber-400' : 'animate-pulse bg-emerald-400'
                  )}
                />
              </div>
              <div>
                <p
                  className={cn(
                    'text-lg font-bold',
                    dryRunMode ? 'text-amber-400' : 'text-emerald-400'
                  )}
                >
                  {dryRunMode ? 'DRY-RUN MODE' : 'LIVE MODE'}
                </p>
                <p className="text-xs text-gray-500">
                  {dryRunMode
                    ? 'No real trades will be executed'
                    : 'Real money is at risk'}
                </p>
              </div>
            </div>

            <Switch
              checked={!dryRunMode}
              onCheckedChange={(checked) => setDryRunMode(!checked)}
              className="data-[state=checked]:bg-emerald-600"
            />

            {!dryRunMode && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <span className="text-xs font-medium text-red-400">
                  Real funds will be used — proceed with caution
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

function FileText(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

function RiskSliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
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
