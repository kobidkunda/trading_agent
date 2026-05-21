'use client';

import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Shield,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DEFAULT_APLUS_CONFIG } from '@/lib/constants';
import type { APlusSignalConfig } from '@/lib/types';

interface APlusGateResult {
  passed: boolean;
  reasons: string[];
  blocker: boolean;
}

interface APlusGatePanelProps {
  result: APlusGateResult;
  config?: APlusSignalConfig;
}

const CRITERION_LABELS: Record<string, string> = {
  ORDERBOOK_ESTIMATED: 'Orderbook source must be real',
  ORDERBOOK_MISSING_BID_ASK: 'Best bid/ask must be present',
  ORDERBOOK_STALE: 'Orderbook must be fresh',
  ORDERBOOK_MISSING_FILL_PROB: 'Fill probability must be available',
  ORDERBOOK_MISSING_PRICE_IMPACT: 'Price impact must be available',
  dataSource: 'Data source must be REAL',
  modelDisagreement: 'Model disagreement threshold',
  oracleRiskScore: 'Oracle risk threshold',
  candidateScore: 'Minimum candidate score',
  adjustedEdge: 'Minimum adjusted edge',
  confidence: 'Minimum confidence',
  resolutionClarity: 'Minimum resolution clarity',
  spread: 'Maximum spread',
  liquidity: 'Liquidity above category minimum',
  oracleCheck: 'Oracle check must be present',
  tailRiskScore: 'Tail risk threshold',
  correlationExposure: 'Correlation exposure threshold',
  orderbookQuality: 'Orderbook quality score',
};

function formatCriterionLabel(reason: string): string {
  // Extract the key phrase from reasons like:
  // "spreadSource X is not REAL_ORDERBOOK — ORDERBOOK_ESTIMATED"
  // "candidateScore 85.0 < 90"
  // "bestBid/bestAsk missing — ORDERBOOK_MISSING_BID_ASK"
  const parts = reason.split(' — ');
  const suffix = parts[parts.length - 1]?.trim();

  if (suffix && suffix in CRITERION_LABELS) {
    return CRITERION_LABELS[suffix];
  }

  const prefix = parts[0]?.trim() ?? reason;

  for (const k of Object.keys(CRITERION_LABELS)) {
    if (prefix.toLowerCase().includes(k.toLowerCase())) {
      return CRITERION_LABELS[k];
    }
  }

  return prefix;
}

function isOrderbookBlocker(reason: string): boolean {
  const blockers = [
    'ORDERBOOK_ESTIMATED',
    'ORDERBOOK_MISSING_BID_ASK',
    'ORDERBOOK_STALE',
    'ORDERBOOK_MISSING_FILL_PROB',
    'ORDERBOOK_MISSING_PRICE_IMPACT',
    'dataSource',
    'modelDisagreement',
    'oracleRiskScore',
  ];
  return blockers.some((b) => reason.includes(b));
}

export function APlusGatePanel({ result, config }: APlusGatePanelProps) {
  const [showConfig, setShowConfig] = useState(false);
  const cfg = config ?? DEFAULT_APLUS_CONFIG;

  const failedReasons = result.reasons;
  const isBlocker = result.blocker;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className={`h-4 w-4 ${result.passed ? 'text-emerald-400' : 'text-red-400'}`} />
          <span className="text-sm font-medium text-white">A+ Gate Criteria</span>
        </div>
        <Badge
          className={
            result.passed
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          }
        >
          {result.passed ? (
            <>
              <CheckCircle className="mr-1 h-3 w-3" />
              Passed
            </>
          ) : (
            <>
              <XCircle className="mr-1 h-3 w-3" />
              Failed
            </>
          )}
        </Badge>
      </div>

      {/* Blocker alert */}
      {isBlocker && !result.passed && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="text-xs font-semibold text-red-400">Blocker Detected</p>
            <p className="mt-0.5 text-xs text-red-400/80">
              Orderbook or data quality issues prevent A+ classification.
            </p>
          </div>
        </div>
      )}

      {/* Criteria list */}
      {failedReasons.length > 0 ? (
        <div className="space-y-1.5">
          {failedReasons.map((reason, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-md px-3 py-2 ${
                isOrderbookBlocker(reason)
                  ? 'border border-red-500/20 bg-red-500/5'
                  : 'border border-gray-800 bg-gray-900'
              }`}
            >
              <XCircle
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                  isOrderbookBlocker(reason) ? 'text-red-400' : 'text-amber-400'
                }`}
              />
              <span
                className={`text-xs ${
                  isOrderbookBlocker(reason) ? 'text-red-300' : 'text-gray-300'
                }`}
              >
                {formatCriterionLabel(reason)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs text-emerald-400">All criteria met</span>
        </div>
      )}

      {/* Config thresholds collapsible */}
      <button
        type="button"
        onClick={() => setShowConfig((v) => !v)}
        className="flex w-full items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-400"
      >
        {showConfig ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Thresholds used
      </button>

      {showConfig && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-gray-800 bg-gray-900 p-3">
          <ThresholdRow label="Min Score" value={cfg.minCandidateScore.toFixed(0)} />
          <ThresholdRow label="Min Edge" value={(cfg.minAdjustedEdge * 100).toFixed(1) + '%'} />
          <ThresholdRow label="Min Confidence" value={(cfg.minConfidence * 100).toFixed(0) + '%'} />
          <ThresholdRow label="Min Clarity" value={(cfg.minResolutionClarity * 100).toFixed(0) + '%'} />
          <ThresholdRow label="Max Spread" value={(cfg.maxSpread * 100).toFixed(2) + '%'} />
          <ThresholdRow label="Max Disagreement" value={(cfg.maxModelDisagreement * 100).toFixed(0) + '%'} />
          <ThresholdRow label="Max Tail Risk" value={(cfg.maxTailRisk * 100).toFixed(0) + '%'} />
          <ThresholdRow label="Max Oracle Risk" value={(cfg.maxOracleRisk * 100).toFixed(0) + '%'} />
          <ThresholdRow label="Max Correlation" value={(cfg.maxCorrelationExposure * 100).toFixed(0) + '%'} />
          {cfg.maxOrderbookAgeSeconds && (
            <ThresholdRow label="Max OB Age" value={cfg.maxOrderbookAgeSeconds + 's'} />
          )}
        </div>
      )}
    </div>
  );
}

function ThresholdRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-gray-500">{label}</span>
      <span className="text-[10px] font-medium tabular-nums text-gray-300">{value}</span>
    </div>
  );
}