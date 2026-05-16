export type TradingMode = 'DEMO' | 'PAPER' | 'LIVE';
export type DataSource = 'MOCK' | 'REAL';
export type ExecutionMode = 'SIMULATED' | 'REAL';

export interface TradingModeState {
  mode: TradingMode;
  dataSource: DataSource;
  executionMode: ExecutionMode;
  allowMockTemplates: boolean;
  liveExecutionAllowed: boolean;
}

const DEFAULT_MODE: TradingMode = 'PAPER';

let currentTradingMode: TradingMode = DEFAULT_MODE;
let _testMode: boolean = true;

export function normalizeTradingMode(mode: string | null | undefined): TradingMode {
  if (mode === 'DEMO' || mode === 'PAPER' || mode === 'LIVE') {
    return mode as TradingMode;
  }

  return DEFAULT_MODE;
}

export function getModeState(mode: TradingMode = currentTradingMode): TradingModeState {
  if (mode === 'DEMO') {
    return {
      mode,
      dataSource: 'MOCK',
      executionMode: 'SIMULATED',
      allowMockTemplates: true,
      liveExecutionAllowed: false,
    };
  }

  if (mode === 'LIVE') {
    return {
      mode,
      dataSource: 'REAL',
      executionMode: 'REAL',
      allowMockTemplates: false,
      liveExecutionAllowed: false,
    };
  }

  return {
    mode: 'PAPER',
    dataSource: 'REAL',
    executionMode: 'SIMULATED',
    allowMockTemplates: false,
    liveExecutionAllowed: false,
  };
}

export function getTradingMode(): TradingMode {
  return currentTradingMode;
}

export function setTradingMode(mode: TradingMode): void {
  currentTradingMode = mode;
  _testMode = mode !== 'LIVE';
}

export function isTestMode(): boolean {
  return _testMode;
}

export function setTestMode(mode: boolean): void {
  _testMode = mode;
  currentTradingMode = mode ? 'PAPER' : 'LIVE';
}

export function getModeLabel(): string {
  return currentTradingMode;
}
