'use client';

import { useEffect, useState, useCallback } from 'react';
/* useState and useEffect used by child components */
import {
  Settings,
  Key,
  ScanSearch,
  BookOpen,
  FileText,
  Activity,
  Menu,
  OctagonX,
  Radio,
  Clock,
  FlaskConical,
} from 'lucide-react';
import { useTradingStore, type PageView } from '@/store/trading-store';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { StrategyHub } from '@/components/trading/StrategyHub';
import { CredentialManager } from '@/components/trading/CredentialManager';
import { MarketTriage } from '@/components/trading/MarketTriage';
import { ResearchLedger } from '@/components/trading/ResearchLedger';
import { PromptStudio } from '@/components/trading/PromptStudio';
import { SystemHealth } from '@/components/trading/SystemHealth';
import { LiveStatus } from '@/components/trading/LiveStatus';
import { SimulationLab } from '@/components/trading/SimulationLab';

interface NavItem {
  id: PageView;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'simulation', label: 'Simulation Lab', icon: FlaskConical },
  { id: 'strategy', label: 'Strategy Hub', icon: Settings },
  { id: 'credentials', label: 'Credentials', icon: Key },
  { id: 'triage', label: 'Market Triage', icon: ScanSearch },
  { id: 'research', label: 'Research Ledger', icon: BookOpen },
  { id: 'prompts', label: 'Prompt Studio', icon: FileText },
  { id: 'live', label: 'Live Status', icon: Radio },
  { id: 'health', label: 'System Health', icon: Activity },
];

function TopBar() {
  const {
    dryRunMode,
    globalKillSwitch,
    setDryRunMode,
    setGlobalKillSwitch,
    toggleSidebar,
  } = useTradingStore();
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
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-gray-800 bg-gray-950/90 px-4 backdrop-blur-md lg:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden text-gray-400 hover:text-white hover:bg-gray-800"
          onClick={toggleSidebar}
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600/20">
          <Radio className="h-4 w-4 text-emerald-400" />
        </div>
        <h1 className="text-sm font-semibold tracking-tight text-white lg:text-base">
          Trading Command Center
        </h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Dry-run / Live toggle */}
        <TooltipProvider>
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
                <span className="hidden sm:inline">
                  {dryRunMode ? 'DRY-RUN' : 'LIVE'}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Click to switch to {dryRunMode ? 'Live' : 'Dry-Run'} mode</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Clock */}
        <div className="hidden items-center gap-1.5 text-xs text-gray-500 md:flex">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-mono tabular-nums">{currentTime}</span>
        </div>

        {/* Emergency stop */}
        <TooltipProvider>
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
        </TooltipProvider>
      </div>
    </header>
  );
}

function Sidebar() {
  const { activePage, setActivePage, globalKillSwitch, sidebarOpen, toggleSidebar } =
    useTradingStore();

  const handleNav = useCallback(
    (page: PageView) => {
      setActivePage(page);
      // Auto-close sidebar on mobile after navigation
      if (window.innerWidth < 1024 && sidebarOpen) {
        toggleSidebar();
      }
    },
    [setActivePage, sidebarOpen, toggleSidebar]
  );

  return (
    <>
      {/* Mobile backdrop overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed left-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-60 flex-col border-r border-gray-800 bg-gray-900 transition-transform duration-200 ease-in-out',
          'lg:sticky lg:top-0 lg:z-10 lg:h-screen lg:translate-x-0 lg:border-r',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3 pt-4 lg:pt-3">
          {NAV_ITEMS.map((item) => {
            const isActive = activePage === item.id;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => handleNav(item.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-emerald-600/15 text-emerald-400 shadow-sm'
                    : 'text-gray-400 hover:bg-gray-800/70 hover:text-gray-200',
                  globalKillSwitch && 'pointer-events-none opacity-40'
                )}
              >
                <Icon className={cn('h-[18px] w-[18px] shrink-0', isActive && 'text-emerald-400')} />
                <span>{item.label}</span>
                {isActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                )}
              </button>
            );
          })}
        </nav>

        <Separator className="bg-gray-800" />

        {/* Footer status */}
        <div className="p-3">
          {globalKillSwitch && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-xs font-semibold text-red-400">
                System Stopped
              </p>
              <p className="mt-0.5 text-[11px] text-red-400/70">
                All trading activity halted
              </p>
            </div>
          )}
          <div className="rounded-lg bg-gray-800/50 px-3 py-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-gray-600">Status</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
              <span className="text-xs text-gray-400">System Online</span>
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
    case 'simulation':
      return <SimulationLab />;
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
    case 'live':
      return <LiveStatus />;
    case 'health':
      return <SystemHealth />;
    default:
      return <SimulationLab />;
  }
}

export default function TradingCommandCenter() {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="dark flex h-screen flex-col overflow-hidden bg-gray-950 text-white">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl p-4 lg:p-6">
              <PageContent />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
