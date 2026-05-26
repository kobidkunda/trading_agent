'use client';

import { useEffect, useState } from 'react';
import {
  SlidersHorizontal,
  Loader2,
  XCircle,
  Save,
  Target,
  TrendingUp,
  Search,
  Shield,
  DollarSign,
  Layers,
  Brain,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ── types ────────────────────────────────────────────────────────────────────

interface GlobalSettings {
  // Signal thresholds
  aPlusScoreThreshold: number;
  minAdjustedEdge: number;
  minLiquidity: number;
  maxSpread: number;
  maxResolutionDays: number;
  confidenceThreshold: number;
  cooldownLengthMinutes: number;
  // Research budgets
  maxDeepPerHour: number;
  maxStandardPerHour: number;
  // Risk limits
  maxDailyExposure: number;
  maxCategoryExposure: number;
  maxClusterExposure: number;
}

const DEFAULT_SETTINGS: GlobalSettings = {
  aPlusScoreThreshold: 90,
  minAdjustedEdge: 0.05,
  minLiquidity: 1000,
  maxSpread: 0.05,
  maxResolutionDays: 30,
  confidenceThreshold: 0.4,
  cooldownLengthMinutes: 30,
  maxDeepPerHour: 5,
  maxStandardPerHour: 20,
  maxDailyExposure: 50000,
  maxCategoryExposure: 10000,
  maxClusterExposure: 25000,
};

// ── component ────────────────────────────────────────────────────────────────

export function AppSettings() {
  const [settings, setSettings] = useState<GlobalSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Fetch settings from both /api/strategy and /api/settings
        const [stratRes, settingsRes] = await Promise.all([
          fetch('/api/strategy'),
          fetch('/api/settings'),
        ]);

        const strategyData = stratRes.ok ? await stratRes.json() : {};
        const settingsData = settingsRes.ok ? await settingsRes.json() : {};

        if (!cancelled) {
          setSettings((prev) => ({
            ...prev,
            // From strategy
            minLiquidity: strategyData.minLiquidity ?? prev.minLiquidity,
            maxSpread: strategyData.maxSpread ?? prev.maxSpread,
            maxResolutionDays: strategyData.maxResolutionDays ?? prev.maxResolutionDays,
            minAdjustedEdge: strategyData.targetEdge ?? prev.minAdjustedEdge,
            maxDailyExposure: strategyData.maxDailyExposure ?? prev.maxDailyExposure,
            maxCategoryExposure: strategyData.maxCategoryExposure ?? prev.maxCategoryExposure,
            // From settings
            aPlusScoreThreshold: settingsData.aPlusScoreThreshold ?? prev.aPlusScoreThreshold,
            confidenceThreshold: settingsData.confidenceThreshold ?? prev.confidenceThreshold,
            cooldownLengthMinutes: settingsData.cooldownLengthMinutes ?? prev.cooldownLengthMinutes,
            maxDeepPerHour: settingsData.maxDeepPerHour ?? prev.maxDeepPerHour,
            maxStandardPerHour: settingsData.maxStandardPerHour ?? prev.maxStandardPerHour,
            maxClusterExposure: settingsData.maxClusterExposure ?? prev.maxClusterExposure,
          }));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load settings');
          toast.error('Failed to load settings');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const updateField = <K extends keyof GlobalSettings>(key: K, value: number) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save to both endpoints
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aPlusScoreThreshold: settings.aPlusScoreThreshold,
          minAdjustedEdge: settings.minAdjustedEdge,
          confidenceThreshold: settings.confidenceThreshold,
          cooldownLengthMinutes: settings.cooldownLengthMinutes,
          maxDeepPerHour: settings.maxDeepPerHour,
          maxStandardPerHour: settings.maxStandardPerHour,
          maxClusterExposure: settings.maxClusterExposure,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      // Also update strategy settings for liquidity/spread/exposure
      const strategyRes = await fetch('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minLiquidity: settings.minLiquidity,
          maxSpread: settings.maxSpread,
          maxResolutionDays: settings.maxResolutionDays,
          targetEdge: settings.minAdjustedEdge,
          maxDailyExposure: settings.maxDailyExposure,
          maxCategoryExposure: settings.maxCategoryExposure,
        }),
      });
      if (!strategyRes.ok) {
        const data = await strategyRes.json().catch(() => ({}));
        throw new Error(data.error ?? `Strategy save failed with HTTP ${strategyRes.status}`);
      }

      setDirty(false);
      toast.success('Settings saved successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  // ── loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-40 animate-pulse rounded bg-gray-800" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
      </div>
    );
  }

  // ── error ──
  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Settings</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => { setError(null); setLoading(true); window.location.reload(); }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Settings</h2>
          <p className="mt-1 text-sm text-gray-500">
            Configure signal thresholds, research budgets, and risk limits
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!dirty || saving}
          className={cn(
            'gap-2 text-sm',
            dirty
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'bg-gray-800 text-gray-400'
          )}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>

      {/* Signal Thresholds */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Target className="h-4 w-4 text-emerald-400" />
            Signal Thresholds
          </CardTitle>
          <CardDescription className="text-xs text-gray-500">
            Minimum thresholds used to determine when a candidate qualifies as a trading signal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">A+ Score Threshold</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={settings.aPlusScoreThreshold}
                onChange={(e) => updateField('aPlusScoreThreshold', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Minimum candidate score for A+ signal classification (0-100).</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Min Adjusted Edge</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={settings.minAdjustedEdge}
                onChange={(e) => updateField('minAdjustedEdge', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Minimum edge after adjusting for fees and slippage (0.00-1.00).</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Min Liquidity ($)</Label>
              <Input
                type="number"
                min={0}
                step={100}
                value={settings.minLiquidity}
                onChange={(e) => updateField('minLiquidity', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Minimum market liquidity required to trade.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Max Spread</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={settings.maxSpread}
                onChange={(e) => updateField('maxSpread', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Maximum bid-ask spread allowed (0.00-1.00).</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Confidence Threshold</Label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={settings.confidenceThreshold}
                onChange={(e) => updateField('confidenceThreshold', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Minimum judge confidence required to execute a trade (0.00-1.00).</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Max Days Until Resolution</Label>
              <Input
                type="number"
                min={1}
                max={365}
                step={1}
                value={settings.maxResolutionDays}
                onChange={(e) => updateField('maxResolutionDays', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Only place new bets on markets that resolve within this many days.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Cooldown Length (minutes)</Label>
              <Input
                type="number"
                min={5}
                max={1440}
                step={5}
                value={settings.cooldownLengthMinutes}
                onChange={(e) => updateField('cooldownLengthMinutes', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Cooldown period after a trade before re-entering same market.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Research Budget */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Brain className="h-4 w-4 text-purple-400" />
            Research Budget
          </CardTitle>
          <CardDescription className="text-xs text-gray-500">
            Rate limits for research operations to control API costs and throughput.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Max Deep Research / Hour</Label>
              <Input
                type="number"
                min={1}
                max={100}
                step={1}
                value={settings.maxDeepPerHour}
                onChange={(e) => updateField('maxDeepPerHour', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Maximum deep research runs per hour (higher cost, more thorough).</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Max Standard Research / Hour</Label>
              <Input
                type="number"
                min={1}
                max={500}
                step={1}
                value={settings.maxStandardPerHour}
                onChange={(e) => updateField('maxStandardPerHour', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Maximum standard research runs per hour (lower cost, basic analysis).</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Risk Limits */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Shield className="h-4 w-4 text-amber-400" />
            Risk Limits
          </CardTitle>
          <CardDescription className="text-xs text-gray-500">
            Maximum exposure limits across different risk dimensions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Max Daily Exposure ($)</Label>
              <Input
                type="number"
                min={100}
                step={1000}
                value={settings.maxDailyExposure}
                onChange={(e) => updateField('maxDailyExposure', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Total dollar exposure limit across all positions per day.</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Max Category Exposure ($)</Label>
              <Input
                type="number"
                min={100}
                step={1000}
                value={settings.maxCategoryExposure}
                onChange={(e) => updateField('maxCategoryExposure', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Maximum exposure per category (e.g., politics, sports).</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Max Cluster Exposure ($)</Label>
              <Input
                type="number"
                min={100}
                step={1000}
                value={settings.maxClusterExposure}
                onChange={(e) => updateField('maxClusterExposure', Number(e.target.value))}
                className="border-gray-800 bg-gray-950 text-sm text-white"
              />
              <p className="text-[11px] text-gray-600">Maximum exposure within a correlation cluster.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dirty state reminder */}
      {dirty && (
        <div className="flex items-center justify-center">
          <p className="text-xs text-amber-400">
            You have unsaved changes. Click &quot;Save Settings&quot; to apply.
          </p>
        </div>
      )}
    </div>
  );
}
