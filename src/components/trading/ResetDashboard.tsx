'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  RotateCcw,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Trash2,
  Shield,
  Database,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

interface TableCount {
  name: string;
  count: number;
  category: string;
}

interface PreviewData {
  counts: Record<string, number>;
  preserved: string[];
}

const CATEGORIES: Record<string, string> = {
  TradeCandidate: 'Pipeline',
  CandidateRun: 'Pipeline',
  ResearchRun: 'Research',
  ResearchSource: 'Research',
  ResearchCheckpoint: 'Research',
  AgentOutput: 'Research',
  Decision: 'Decisions',
  Fill: 'Orders',
  Order: 'Orders',
  PaperBet: 'Paper Trading',
  Position: 'Paper Trading',
  MarketSnapshot: 'Markets',
  HistoricalSnapshot: 'Markets',
  Market: 'Markets',
  Outcome: 'Outcomes',
  Postmortem: 'Outcomes',
  ScanRun: 'Scanning',
  VenueCursor: 'Scanning',
  Job: 'Jobs',
  WalletTrade: 'Wallets',
  Wallet: 'Wallets',
  EnsemblePrediction: 'Ensemble',
  CorrelationCluster: 'Risk',
  ClusterMarketLink: 'Risk',
  OracleCheck: 'Risk',
  CausalTreeNode: 'Risk',
  RelatedMarket: 'Related',
  StrategyConfigVersion: 'Backtests',
  BacktestRun: 'Backtests',
  OrderbookSnapshot: 'Orderbook',
  Watchlist: 'Watchlist',
  AuditLog: 'Audit',
};

const PRESERVED_DESCRIPTIONS: Record<string, string> = {
  Credential: 'Exchange & AI service API keys',
  PromptTemplate: 'Agent prompt templates',
  Settings: 'App configuration & strategy settings',
};

export function ResetDashboard() {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reset');
      if (!res.ok) throw new Error('Failed to fetch preview');
      const data = await res.json();
      setPreview(data);
    } catch (err) {
      toast.error('Failed to load data preview');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const handleReset = async () => {
    if (confirmText !== 'RESET') {
      toast.error('Type RESET to confirm');
      return;
    }

    setResetting(true);
    try {
      const res = await fetch('/api/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');

      const totalCleared = data.cleared?.reduce((sum: number, entry: string) => {
        const parts = entry.split(':');
        return sum + (parseInt(parts[1] || '0', 10) || 0);
      }, 0) || 0;

      toast.success(`Reset complete: ${totalCleared} records cleared across ${data.cleared?.length || 0} tables`);
      if (data.errors?.length > 0) {
        toast.warning(`${data.errors.length} tables had errors`);
      }

      setShowConfirm(false);
      setConfirmText('');
      await fetchPreview();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Reset failed';
      toast.error(msg);
    } finally {
      setResetting(false);
    }
  };

  const tableCounts: TableCount[] = preview
    ? Object.entries(preview.counts)
        .filter(([, count]) => count > 0)
        .map(([name, count]) => ({
          name,
          count,
          category: CATEGORIES[name] || 'Other',
        }))
        .sort((a, b) => b.count - a.count)
    : [];

  const totalRecords = tableCounts.reduce((sum, t) => sum + t.count, 0);
  const categories = [...new Set(tableCounts.map((t) => t.category))];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Reset Trading Data</h2>
        <p className="mt-1 text-sm text-gray-400">
          Clear all trade data and start fresh. Configuration is preserved.
        </p>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="h-5 w-5" />
            Destructive Operation
          </CardTitle>
          <CardDescription className="text-amber-400/70">
            This will permanently delete all trade data. This action cannot be undone.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-2">
            <CardDescription>Total Records</CardDescription>
            <CardTitle className="text-3xl font-bold text-white">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : totalRecords.toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-2">
            <CardDescription>Tables with Data</CardDescription>
            <CardTitle className="text-3xl font-bold text-white">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : tableCounts.length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-2">
            <CardDescription>Categories</CardDescription>
            <CardTitle className="text-3xl font-bold text-white">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : categories.length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5 text-red-400" />
              Data to be Cleared
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : tableCounts.length === 0 ? (
              <p className="text-sm text-gray-500">No trade data found — already clean.</p>
            ) : (
              <div className="space-y-3">
                {categories.map((cat) => (
                  <div key={cat}>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      {cat}
                    </h4>
                    <div className="space-y-1">
                      {tableCounts
                        .filter((t) => t.category === cat)
                        .map((t) => (
                          <div
                            key={t.name}
                            className="flex items-center justify-between rounded bg-gray-800/50 px-2 py-1"
                          >
                            <span className="text-sm text-gray-300">{t.name}</span>
                            <Badge variant="secondary" className="text-xs">
                              {t.count.toLocaleString()}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-gray-800 bg-gray-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5 text-emerald-400" />
              Preserved (Configuration)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {preview?.preserved.map((name) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-300">{name}</span>
                  </div>
                  <span className="text-xs text-emerald-400/60">
                    {PRESERVED_DESCRIPTIONS[name] || 'Configuration'}
                  </span>
                </div>
              ))}
            </div>

            <Separator className="my-4" />

            <div className="space-y-2 text-xs text-gray-500">
              <p>Also preserved:</p>
              <ul className="ml-4 list-disc space-y-1">
                <li>Strategy settings & trading config</li>
                <li>Prompt templates (all versions)</li>
                <li>Exchange & AI service credentials</li>
                <li>App settings (key-value store)</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {!showConfirm ? (
        <Button
          variant="destructive"
          size="lg"
          className="w-full gap-2"
          disabled={loading || totalRecords === 0}
          onClick={() => setShowConfirm(true)}
        >
          <Trash2 className="h-4 w-4" />
          Clear All Trade Data
        </Button>
      ) : (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Confirm Reset
            </CardTitle>
            <CardDescription className="text-red-400/70">
              Type <span className="font-bold">RESET</span> to confirm deletion of{' '}
              {totalRecords.toLocaleString()} records.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type RESET to confirm"
              className="w-full rounded-md border border-red-500/30 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1 gap-2"
                disabled={confirmText !== 'RESET' || resetting}
                onClick={handleReset}
              >
                {resetting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                {resetting ? 'Resetting...' : 'Confirm Reset'}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={resetting}
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmText('');
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}