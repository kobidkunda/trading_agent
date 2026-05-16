import type { TradingMode } from '@/lib/engine/mode';

export interface SimulationAccessResult {
  allowed: boolean;
  reason: string | null;
}

export function getSimulationAccess(mode: TradingMode): SimulationAccessResult {
  // DEMO: mock templates, full pipeline simulation → always allowed
  if (mode === 'DEMO') {
    return {
      allowed: true,
      reason: null,
    };
  }

  // PAPER: real scanner, simulated execution → allowed (engine supports runPaperLoop)
  if (mode === 'PAPER') {
    return {
      allowed: true,
      reason: null,
    };
  }

  // LIVE: real scanner, real execution → blocked (requires safety gates)
  return {
    allowed: false,
    reason: `Live execution requires safety gate confirmation. Use the trading market loop for LIVE mode.`,
  };
}
