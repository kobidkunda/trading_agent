'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Settings,
  Key,
  ScanSearch,
  BookOpen,
  FileText,
  Activity,
  Menu,
  X,
  OctagonX,
  Radio,
  Clock,
} from 'lucide-react';
import { useTradingStore, type PageView } from '@/store/trading-store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { StrategyHub } from '@/components/trading/StrategyHub';
import { CredentialManager } from '@/components/trading/CredentialManager';
import { MarketTriage } from '@/components/trading/MarketTriage';
import { ResearchLedger } from '@/components/trading/ResearchLedger';
import { PromptStudio } from '@/components/trading/PromptStudio';
import { SystemHealth } from '@/components/trading/SystemHealth';

interface NavItem {
  id: PageView;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'strategy', label: 'Strategy Hub', icon: Settings },
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'triage', label: 'Market Triage', icon: ScanSearch },
  { id: 'research', label: 'Research Ledger', icon: BookOpen },
  { id: 'prompts', label: 'Prompt Studio', icon: FileText },
  { id: 'health', label: 'System Health', icon: Activity },
];

function TopBar() {
  const { dryRunMode, globalKillSwitch, setDryRunMode, setGlobalKillSwitch } =
    useTradingStore();
  const [currentTime, setCurrentTime] = useState('');

  useEffect(() => {
    const tick = () => {
      setCurrentTime(
        new Date().toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-800 bg-gray-950/80 px-4 backdrop-blur-md lg:px-6">
      <div className="flex items-center gap-3">
        <div className="hidden h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/20 sm:flex">
          <Radio className="h-4 w-4 text-emerald-400" />
        </div>
        <h1 className="text-sm font-semibold tracking-tight text-white lg:text-base">
          Trading Command Center
        </h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Dry-run / Live toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'gap-2 text-xs font-medium',
                dryRunMode
                  ? 'text-amber-400 hover:text-amber-300'
                  : 'text-emerald-400 hover:text-emerald-300'
              )}
              onClick={() => setDryRunMode(!dryRunMode)}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  dryRunMode ? 'bg-amber-400' : 'animate-pulse bg-emerald-400'
                )}
              />
              <span className="hidden sm:inline">{dryRunMode ? 'DRY-RUN' : 'LIVE'}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Click to switch to {dryRunMode ? 'Live' : 'Dry-Run'} mode</p>
          </TooltipContent>
        </Tooltip>

        {/* Clock */}
        <div className="hidden items-center gap-1.5 text-xs text-gray-500 md:flex">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-mono tabular-nums">{currentTime}</span>
        </div>

        {/* Emergency stop */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={globalKillSwitch ? 'destructive' : 'ghost'}
              size="sm"
              className={cn(
                'gap-2 text-xs font-medium transition-all',
                globalKillSwitch
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
              )}
              onClick={() => setGlobalKillSwitch(!globalKillSwitch)}
            >
              <OctagonX className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">
                {globalKillSwitch ? 'STOPPED' : 'E-STOP'}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {globalKillSwitch
                ? 'Emergency stop active — click to resume'
                : 'Emergency stop — halts all trading activity'}
            </p>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function Sidebar({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const { activePage, setActivePage, globalKillSwitch } = useTradingStore();

  const handleNav = useCallback(
    (page: PageView) => {
      setActivePage(page);
      if (window.innerWidth < 1024) onToggle();
    },
    [setActivePage, onToggle]
  );

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onToggle}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-56 flex-col border-r border-gray-800 bg-gray-900 transition-transform duration-300 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {NAV_ITEMS.map((item) => {
            const isActive = activePage === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-gray-800 text-white shadow-sm shadow-black/20'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200',
                  globalKillSwitch && 'pointer-events-none opacity-40'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
                {isActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}
        </nav>

        <Separator className="bg-gray-800" />

        <div className="p-3">
          {globalKillSwitch && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-xs font-semibold text-red-400">
                ⚠ System Stopped
              </p>
              <p className="mt-0.5 text-[11px] text-red-400/70">
                All trading activity halted
              </p>
            </div>
          )}
          <div className="rounded-lg bg-gray-800/50 px-3 py-2">
            <p className="text-[11px] font-medium text-gray-500">Status</p>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-gray-400">Connected</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function PageContent() {
  const { activePage } = useTradingStore();

  switch (activePage) {
    case 'strategy':
      return <StrategyHub />;
    case 'credentials':
      return <CredentialManager />;
    case 'triage':
      return <MarketTriage />;
    case 'research':
      return <ResearchLedger />;
    case 'prompts':
      return <PromptStudio />;
    case 'health':
      return <SystemHealth />;
    default:
      return <StrategyHub />;
  }
}

export default function TradingCommandCenter() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          <span className="text-sm text-gray-500">Initializing...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dark flex h-screen flex-col bg-gray-950 text-white">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          open={useTradingStore.getState().sidebarOpen}
          onToggle={() => useTradingStore.getState().toggleSidebar()}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-4 lg:p-6">
            <PageContent />
          </div>
        </main>
      </div>
    </div>
  );
}
