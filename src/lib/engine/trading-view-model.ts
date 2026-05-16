import type { TradingMode } from '@/lib/engine/mode';

export interface ModeDisplayCopy {
  label: string;
  description: string;
  badgeTone: 'amber' | 'emerald' | 'red';
}

export function getModeDisplayCopy(mode: TradingMode): ModeDisplayCopy {
  if (mode === 'DEMO') {
    return {
      label: 'DEMO MODE',
      description: 'Mock markets and simulated execution for UI testing',
      badgeTone: 'amber',
    };
  }

  if (mode === 'LIVE') {
    return {
      label: 'LIVE MODE',
      description: 'Real market data with real execution when safety allows',
      badgeTone: 'red',
    };
  }

  return {
    label: 'PAPER MODE',
    description: 'Real market data with simulated paper execution',
    badgeTone: 'emerald',
  };
}

export function getModeToggleTarget(mode: TradingMode): TradingMode {
  if (mode === 'DEMO') return 'PAPER';
  if (mode === 'PAPER') return 'LIVE';
  return 'PAPER';
}

export function isLiveRiskBannerVisible(mode: TradingMode): boolean {
  return mode === 'LIVE';
}
