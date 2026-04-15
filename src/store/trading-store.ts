import { create } from 'zustand';

export type PageView = 'strategy' | 'credentials' | 'triage' | 'research' | 'prompts' | 'health';

interface TradingStore {
  activePage: PageView;
  sidebarOpen: boolean;
  dryRunMode: boolean;
  globalKillSwitch: boolean;
  setActivePage: (page: PageView) => void;
  toggleSidebar: () => void;
  setDryRunMode: (mode: boolean) => void;
  setGlobalKillSwitch: (enabled: boolean) => void;
}

export const useTradingStore = create<TradingStore>((set) => ({
  activePage: 'strategy',
  sidebarOpen: true,
  dryRunMode: true,
  globalKillSwitch: false,
  setActivePage: (page) => set({ activePage: page }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setDryRunMode: (mode) => set({ dryRunMode: mode }),
  setGlobalKillSwitch: (enabled) => set({ globalKillSwitch: enabled }),
}));
