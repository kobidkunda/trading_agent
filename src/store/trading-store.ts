import { create } from 'zustand';
import { getModeState, type DataSource, type ExecutionMode, type TradingMode } from '@/lib/engine/mode';

export type PageView = 'strategy' | 'credentials' | 'triage' | 'research' | 'prompts' | 'simulation' | 'live' | 'health' | 'vectorDb' | 'pipelineSettings' | 'map' | 'researchProvider';

interface TradingStore {
  activePage: PageView;
  sidebarOpen: boolean;
  tradingMode: TradingMode;
  dataSource: DataSource;
  executionMode: ExecutionMode;
  dryRunMode: boolean;
  globalKillSwitch: boolean;
  setActivePage: (page: PageView) => void;
  toggleSidebar: () => void;
  setTradingMode: (mode: TradingMode) => void;
  setDryRunMode: (mode: boolean) => void;
  setGlobalKillSwitch: (enabled: boolean) => void;
}

const defaultModeState = getModeState('PAPER');

export const useTradingStore = create<TradingStore>((set) => ({
  activePage: 'simulation',
  sidebarOpen: true,
  tradingMode: defaultModeState.mode,
  dataSource: defaultModeState.dataSource,
  executionMode: defaultModeState.executionMode,
  dryRunMode: true,
  globalKillSwitch: true,
  setActivePage: (page) => set({ activePage: page }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setTradingMode: (mode) => {
    const modeState = getModeState(mode);
    set({
      tradingMode: modeState.mode,
      dataSource: modeState.dataSource,
      executionMode: modeState.executionMode,
      dryRunMode: mode !== 'LIVE',
    });
  },
  setDryRunMode: (mode) => {
    const tradingMode: TradingMode = mode ? 'PAPER' : 'LIVE';
    const modeState = getModeState(tradingMode);
    set({
      tradingMode: modeState.mode,
      dataSource: modeState.dataSource,
      executionMode: modeState.executionMode,
      dryRunMode: mode,
    });
  },
  setGlobalKillSwitch: (enabled) => set({ globalKillSwitch: enabled }),
}));
