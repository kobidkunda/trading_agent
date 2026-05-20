'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
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
  Database,
  Network,
  Target,
  Wallet,
  GitCompare,
  BarChart3,
  Shield,
  ScrollText,
  CheckCircle,
  ListOrdered,
  Gauge,
  TrendingUp,
  History,
  SlidersHorizontal,
  Cpu,
  ClipboardList,
  Wrench,
} from 'lucide-react';
import { useTradingStore } from '@/store/trading-store';
import {
  TRADING_PAGES,
  getTradingPageById,
  getTradingPageHref,
  type PageView,
} from '@/lib/navigation/trading-pages';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getModeDisplayCopy, getModeToggleTarget } from '@/lib/engine/trading-view-model';
import { syncTradingModeFromBackend } from '@/lib/engine/trading-mode-client';
import { StrategyHub } from '@/components/trading/StrategyHub';
import { CredentialManager } from '@/components/trading/CredentialManager';
import { MarketTriage } from '@/components/trading/MarketTriage';
import { ResearchLedger } from '@/components/trading/ResearchLedger';
import { PromptStudio } from '@/components/trading/PromptStudio';
import { SystemHealth } from '@/components/trading/SystemHealth';
import { LiveStatus } from '@/components/trading/LiveStatus';
import { SimulationLab } from '@/components/trading/SimulationLab';
import { PipelineSettings } from '@/components/trading/PipelineSettings';
import { VectorDB } from '@/components/trading/VectorDB';
import { SystemMap } from '@/components/trading/SystemMap';
import { ResearchProvider } from '@/components/trading/ResearchProvider';
import { CandidatesDashboard } from '@/components/trading/CandidatesDashboard';
import { APlusSignalsDashboard } from '@/components/trading/APlusSignalsDashboard';
import { CalibrationDashboard } from '@/components/trading/CalibrationDashboard';
import { RiskDashboard } from '@/components/trading/RiskDashboard';
import { PaperOrdersDashboard } from '@/components/trading/PaperOrdersDashboard';
import { OutcomesDashboard } from '@/components/trading/OutcomesDashboard';
import { ResearchQueueDashboard } from '@/components/trading/ResearchQueueDashboard';
import { WalletsDashboard } from '@/components/trading/WalletsDashboard';
import { RelatedMarketsDashboard } from '@/components/trading/RelatedMarketsDashboard';
import { OrderbookDashboard } from '@/components/trading/OrderbookDashboard';
import { PaperBetsDashboard } from '@/components/trading/PaperBetsDashboard';
import { BacktestsDashboard } from '@/components/trading/BacktestsDashboard';
import { StrategyOptimizerDashboard } from '@/components/trading/StrategyOptimizerDashboard';
import { AppSettings } from '@/components/trading/AppSettings';
import { LogsDashboard } from '@/components/trading/LogsDashboard';
import { QdrantSetupWizard } from '@/components/trading/QdrantSetupWizard';

interface NavItem {
  id: PageView;
  label: string;
  icon: React.ElementType;
}

const NAV_ICONS: Record<PageView, React.ElementType> = {
  simulation: FlaskConical,
  strategy: Settings,
  credentials: Key,
  triage: ScanSearch,
  candidates: Target,
  aPlusSignals: TrendingUp,
  research: BookOpen,
  researchQueue: ListOrdered,
  prompts: FileText,
  wallets: Wallet,
  relatedMarkets: GitCompare,
  orderbook: Gauge,
  risk: Shield,
  paperOrders: ScrollText,
  paperBets: BarChart3,
  outcomes: CheckCircle,
  calibration: BarChart3,
  backtests: History,
  optimizer: Cpu,
  live: Radio,
  health: Activity,
  settings: SlidersHorizontal,
  vectorDb: Database,
  pipelineSettings: Settings,
  map: Network,
  researchProvider: BookOpen,
  logs: ClipboardList,
  qdrantWizard: Wrench,
};

const NAV_ITEMS: NavItem[] = TRADING_PAGES.map((page) => ({
  id: page.id,
  label: page.label,
  icon: NAV_ICONS[page.id],
}));

function TopBar() {
  const {
    tradingMode,
    globalKillSwitch,
    setTradingMode,
    setDryRunMode,
    setGlobalKillSwitch,
    toggleSidebar,
  } = useTradingStore();
  const [currentTime, setCurrentTime] = useState('');
  const [mounted, setMounted] = useState(false);
  const killSwitchManualOverride = useRef(false);

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
    setMounted(true);
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    syncTradingModeFromBackend().catch(() => {
      // keep local defaults when backend mode unavailable
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const syncSimulationStatus = async () => {
      try {
        if (killSwitchManualOverride.current) return;

        const response = await fetch('/api/simulation', { cache: 'no-store' });
        if (!response.ok || cancelled) return;

        const payload = (await response.json()) as { status?: string };
        const simRunning = payload.status === 'RUNNING';
        setGlobalKillSwitch(!simRunning);
        killSwitchManualOverride.current = false;
      } catch {
        // keep current UI state when simulation status is temporarily unavailable
      }
    };

    void syncSimulationStatus();
    const interval = setInterval(() => {
      void syncSimulationStatus();
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [setGlobalKillSwitch]);

  const modeCopy = getModeDisplayCopy(tradingMode);
  const nextMode = getModeToggleTarget(tradingMode);

  const handleModeToggle = useCallback(() => {
    if (tradingMode === 'PAPER') {
      setDryRunMode(false);
      return;
    }

    setTradingMode(nextMode);
  }, [nextMode, setDryRunMode, setTradingMode, tradingMode]);

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-gray-800 bg-gray-950/90 px-4 backdrop-blur-md lg:px-6">
      <div className="flex items-center gap-3">
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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'gap-2 text-xs font-medium',
                  tradingMode === 'DEMO'
                    ? 'text-amber-400 hover:text-amber-300'
                    : tradingMode === 'LIVE'
                      ? 'text-red-400 hover:text-red-300'
                      : 'text-emerald-400 hover:text-emerald-300'
                )}
                onClick={handleModeToggle}
              >
                <span
                  className={cn(
                    'h-2 w-2 rounded-full',
                    tradingMode === 'DEMO'
                      ? 'bg-amber-400'
                      : tradingMode === 'LIVE'
                        ? 'bg-red-400'
                        : 'animate-pulse bg-emerald-400'
                  )}
                />
                <span className="hidden sm:inline">{tradingMode}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Click to switch to {nextMode} mode</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="hidden items-center gap-1.5 text-xs text-gray-500 md:flex">
          <Clock className="h-3.5 w-3.5" />
          <span className="font-mono tabular-nums">{mounted ? currentTime : ''}</span>
        </div>

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
                onClick={() => {
                  killSwitchManualOverride.current = true;
                  setGlobalKillSwitch(!globalKillSwitch);
                }}
              >
                <OctagonX className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{globalKillSwitch ? 'STOPPED' : 'E-STOP'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {globalKillSwitch
                  ? 'Emergency stop active — click to resume'
                  : `${modeCopy.label} emergency stop — halts all trading activity`}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  );
}

function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { activePage, setActivePage, globalKillSwitch, sidebarOpen, toggleSidebar } =
    useTradingStore();

  const handleNav = useCallback(
    (page: PageView) => {
      const href = getTradingPageHref(page);
      setActivePage(page);
      if (pathname !== href) {
        router.push(href);
      }
      if (window.innerWidth < 1024 && sidebarOpen) {
        toggleSidebar();
      }
    },
    [pathname, router, setActivePage, sidebarOpen, toggleSidebar]
  );

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-14 z-40 flex h-[calc(100vh-3.5rem)] w-60 flex-col border-r border-gray-800 bg-gray-900 transition-transform duration-200 ease-in-out',
          'lg:sticky lg:top-0 lg:z-10 lg:h-screen lg:translate-x-0 lg:border-r',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
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
                  globalKillSwitch && 'opacity-40',
                  isActive
                    ? 'bg-emerald-600/15 text-emerald-400 shadow-sm'
                    : 'text-gray-400 hover:bg-gray-800/70 hover:text-gray-200'
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

        <div className="p-3">
          {globalKillSwitch && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-xs font-semibold text-red-400">System Stopped</p>
              <p className="mt-0.5 text-[11px] text-red-400/70">All trading activity halted</p>
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

function PageContent({ activePage }: { activePage: PageView }) {
  switch (activePage) {
    case 'simulation':
      return <SimulationLab />;
    case 'strategy':
      return <StrategyHub />;
    case 'credentials':
      return <CredentialManager />;
    case 'triage':
      return <MarketTriage />;
    case 'candidates':
      return <CandidatesDashboard />;
    case 'aPlusSignals':
      return <APlusSignalsDashboard />;
    case 'research':
      return <ResearchLedger />;
    case 'researchQueue':
      return <ResearchQueueDashboard />;
    case 'prompts':
      return <PromptStudio />;
    case 'wallets':
      return <WalletsDashboard />;
    case 'relatedMarkets':
      return <RelatedMarketsDashboard />;
    case 'orderbook':
      return <OrderbookDashboard />;
    case 'risk':
      return <RiskDashboard />;
    case 'paperOrders':
      return <PaperOrdersDashboard />;
    case 'paperBets':
      return <PaperBetsDashboard />;
    case 'outcomes':
      return <OutcomesDashboard />;
    case 'calibration':
      return <CalibrationDashboard />;
    case 'backtests':
      return <BacktestsDashboard />;
    case 'optimizer':
      return <StrategyOptimizerDashboard />;
    case 'live':
      return <LiveStatus />;
    case 'health':
      return <SystemHealth />;
    case 'settings':
      return <AppSettings />;
    case 'vectorDb':
      return <VectorDB />;
    case 'pipelineSettings':
      return <PipelineSettings />;
    case 'map':
      return <SystemMap />;
    case 'researchProvider':
      return <ResearchProvider />;
    case 'logs':
      return <LogsDashboard />;
    case 'qdrantWizard':
      return <QdrantSetupWizardWrapper />;
    default:
      return <SimulationLab />;
  }
}

function QdrantSetupWizardWrapper() {
  const [open, setOpen] = useState(true);
  return (
    <QdrantSetupWizard
      open={open}
      onOpenChange={setOpen}
      credentialId=""
    />
  );
}

export function TradingCommandCenterShell({ initialPage }: { initialPage: PageView }) {
  const { activePage, setActivePage } = useTradingStore();

  useEffect(() => {
    if (activePage !== initialPage) {
      setActivePage(initialPage);
    }
  }, [activePage, initialPage, setActivePage]);

  const resolvedPage = activePage === initialPage ? activePage : initialPage;
  const pageTitle = getTradingPageById(resolvedPage).label;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="dark flex h-screen flex-col overflow-hidden bg-gray-950 text-white">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-7xl p-4 lg:p-6">
              <div className="sr-only">{pageTitle}</div>
              <PageContent activePage={resolvedPage} />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
