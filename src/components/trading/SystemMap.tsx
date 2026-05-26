'use client';

import { useEffect, useState } from 'react';
import {
  Network,
  Server,
  Search,
  Database,
  Brain,
  Cpu,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Loader2,
  ExternalLink,
  Shield,
  Zap,
  Globe,
  BookOpen,
  Activity,
  GitBranch,
  Wallet,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ServiceStatus {
  name: string;
  status: 'healthy' | 'unhealthy' | 'checking' | 'unknown';
  message?: string;
}

interface PipelineStageInfo {
  id: string;
  label: string;
  description: string;
  color: string;
  bgColor: string;
  agentRole?: string;
  usesModel?: boolean;
  usesSearch?: boolean;
  usesVectorDb?: boolean;
  usesDeerFlow?: boolean;
  usesAgentReach?: boolean;
  usesTradingAgents?: boolean;
  usesFinance?: boolean;
}

const PIPELINE_STAGES: PipelineStageInfo[] = [
  { id: 'scan', label: 'Scan', description: 'Fetch markets from Polymarket & Kalshi', color: 'text-gray-400', bgColor: 'bg-gray-500/10' },
  { id: 'triage', label: 'Triage', description: 'Classify market as relevant / irrelevant / ambiguous', color: 'text-violet-400', bgColor: 'bg-violet-500/10', agentRole: 'TRIAGE', usesModel: true },
  { id: 'research', label: 'Research Fan-Out', description: 'Web search plus deep providers kick off based on Research Depth', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10', usesSearch: true },
  { id: 'deerflow', label: 'DeerFlow', description: 'Deep iterative research or DeerFlow API run with app-selected model', color: 'text-indigo-400', bgColor: 'bg-indigo-500/10', usesDeerFlow: true, usesModel: true, usesSearch: true },
  { id: 'analysts', label: 'TradingAgents', description: 'Parallel analysts with app-driven provider, deep/quick models, and debate rounds', color: 'text-rose-400', bgColor: 'bg-rose-500/10', agentRole: 'ANALYSTS', usesModel: true, usesSearch: true, usesTradingAgents: true, usesFinance: true },
  { id: 'agent-reach', label: 'Agent-Reach', description: 'Optional social/discussion ingestion branch and TradingAgents enrichment source', color: 'text-sky-400', bgColor: 'bg-sky-500/10', usesAgentReach: true, usesSearch: true },
  { id: 'synthesis', label: 'Synthesis', description: 'Merge DeerFlow, TradingAgents, Agent-Reach, and web evidence into one research output', color: 'text-fuchsia-400', bgColor: 'bg-fuchsia-500/10', usesModel: true },
  { id: 'bull', label: 'Bull', description: 'Argue for the trade (bullish case)', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', agentRole: 'BULL', usesModel: true },
  { id: 'bear', label: 'Bear', description: 'Argue against the trade (bearish case)', color: 'text-red-400', bgColor: 'bg-red-500/10', agentRole: 'BEAR', usesModel: true },
  { id: 'contradiction', label: 'Contradiction', description: 'Find contradictions & overlooked risks', color: 'text-amber-400', bgColor: 'bg-amber-500/10', agentRole: 'CONTRADICTION', usesModel: true },
  { id: 'judge', label: 'Judge', description: 'Estimate true probability & confidence', color: 'text-cyan-400', bgColor: 'bg-cyan-500/10', agentRole: 'JUDGE', usesModel: true },
  { id: 'risk', label: 'Risk Engine', description: 'Deterministic risk checks & Kelly sizing', color: 'text-orange-400', bgColor: 'bg-orange-500/10' },
  { id: 'execute', label: 'Execute', description: 'Place order (paper in dry-run, live in live mode)', color: 'text-emerald-600', bgColor: 'bg-emerald-600/10' },
];

const SERVICE_DEFS = [
  { id: 'llm', label: 'LLM Provider', url: '', icon: Cpu, color: 'text-blue-400', borderColor: 'border-blue-500/40', desc: 'All agent LLM calls (triage, bull, bear, contradiction, judge)' },
  { id: 'deerflow', label: 'DeerFlow Research', url: '', icon: Brain, color: 'text-indigo-400', borderColor: 'border-indigo-500/40', desc: 'Deep multi-hop research with optional API model selection and local fallback' },
  { id: 'tradingagents', label: 'TradingAgents', url: 'http://localhost:6503', icon: Activity, color: 'text-rose-400', borderColor: 'border-rose-500/40', desc: 'Multi-source analysts with app-driven provider, deep/quick models, and debate rounds' },
  { id: 'agent-reach', label: 'Agent-Reach', url: '', icon: GitBranch, color: 'text-sky-400', borderColor: 'border-sky-500/40', desc: 'Optional MCP social ingestion used directly and as TradingAgents enrichment' },
  { id: 'searxng', label: 'SearXNG', url: '', icon: Search, color: 'text-amber-400', borderColor: 'border-amber-500/40', desc: 'Web search for research, DeerFlow iteration, and TradingAgents social discovery' },
  { id: 'finance', label: 'Finance Vendors', url: 'Alpha Vantage / Finnhub', icon: Wallet, color: 'text-emerald-400', borderColor: 'border-emerald-500/40', desc: 'Optional ta-service enrichment for tradable symbols and proxy context' },
  { id: 'qdrant', label: 'Qdrant', url: '', icon: Database, color: 'text-purple-400', borderColor: 'border-purple-500/40', desc: 'Vector database for research memory & similar market retrieval' },
];

export function SystemMap() {
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [checking, setChecking] = useState(false);

  const checkHealth = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        const svcs: ServiceStatus[] = (data.services || []).map((s: { name: string; status: string; message?: string }) => ({
          name: s.name,
          status: s.status === 'healthy' ? 'healthy' as const : 'unhealthy' as const,
          message: s.message,
        }));
        setServices(svcs);
      }
    } catch {
      setServices([]);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  const getServiceStatus = (svcId: string): ServiceStatus | undefined => {
    const nameMap: Record<string, string[]> = {
      llm: ['LLM Provider', 'llm'],
      deerflow: ['DeerFlow Research', 'deerflow'],
      tradingagents: ['TradingAgents', 'tradingagents'],
      'agent-reach': ['Agent-Reach', 'agent reach', 'agent_reach'],
      searxng: ['SearXNG', 'searxng'],
      finance: ['Alpha Vantage', 'Finnhub', 'finance'],
      qdrant: ['Qdrant', 'qdrant'],
    };
    const names = nameMap[svcId] || [svcId];
    return services.find((s) => names.some((n) => s.name.toLowerCase().includes(n.toLowerCase())));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">System Map</h2>
          <p className="mt-1 text-sm text-gray-500">
            Architecture overview — services, pipeline, and data flow
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
          onClick={checkHealth}
          disabled={checking}
        >
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh Health
        </Button>
      </div>

      {/* ─── Services ─── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Server className="h-4 w-4 text-cyan-400" />
            External Services
          </CardTitle>
          <CardDescription className="text-gray-500">
            Configurable through Credentials page
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 xl:grid-cols-7">
            {SERVICE_DEFS.map((svc) => {
              const status = getServiceStatus(svc.id);
              const Icon = svc.icon;
              const isHealthy = status?.status === 'healthy';
              const isUnhealthy = status?.status === 'unhealthy';
              return (
                <div
                  key={svc.id}
                  className={cn('rounded-lg border p-3', svc.borderColor, isHealthy ? 'bg-green-500/5' : isUnhealthy ? 'bg-red-500/5' : 'bg-gray-800/40')}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className={cn('h-4 w-4', svc.color)} />
                      <span className="text-sm font-medium text-white">{svc.label}</span>
                    </div>
                    {isHealthy ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    ) : isUnhealthy ? (
                      <XCircle className="h-3.5 w-3.5 text-red-400" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 text-gray-600" />
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-gray-600 truncate font-mono">{svc.url || 'Not configured'}</p>
                  <p className="mt-1 text-[11px] text-gray-500">{svc.desc}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ─── Pipeline Flow ─── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Network className="h-4 w-4 text-violet-400" />
            Pipeline Data Flow
          </CardTitle>
          <CardDescription className="text-gray-500">
            How a market moves through the system from scan to execution
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {PIPELINE_STAGES.map((stage, idx) => (
              <div key={stage.id} className="flex items-start gap-3">
                {idx > 0 && (
                  <div className="absolute -mt-1 ml-3.5 hidden">
                    <ArrowRight className="h-3 w-3 text-gray-700 rotate-90" />
                  </div>
                )}
                <div className="flex w-full items-start gap-3 rounded-lg border border-gray-800 bg-gray-800/20 px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-xs font-bold text-gray-500">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('text-sm font-medium', stage.color)}>{stage.label}</span>
                      {stage.agentRole && (
                        <Badge className={cn('text-[9px]', stage.bgColor, stage.color, 'border-0')}>
                          {stage.agentRole}
                        </Badge>
                      )}
                      {stage.usesDeerFlow && (
                        <Badge className="text-[9px] border-indigo-500/30 bg-indigo-500/10 text-indigo-400">
                          DEERFLOW
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-500">{stage.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {stage.usesModel && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-blue-400/70">
                          <Cpu className="h-2.5 w-2.5" /> LLM
                        </span>
                      )}
                      {stage.usesSearch && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/70">
                          <Search className="h-2.5 w-2.5" /> SearXNG
                        </span>
                      )}
                      {stage.usesVectorDb && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-purple-400/70">
                          <Database className="h-2.5 w-2.5" /> Qdrant
                        </span>
                      )}
                      {stage.usesDeerFlow && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-indigo-400/70">
                          <Brain className="h-2.5 w-2.5" /> DeerFlow API
                        </span>
                      )}
                      {stage.usesTradingAgents && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-rose-400/70">
                          <Activity className="h-2.5 w-2.5" /> TradingAgents
                        </span>
                      )}
                      {stage.usesAgentReach && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-sky-400/70">
                          <GitBranch className="h-2.5 w-2.5" /> Agent-Reach
                        </span>
                      )}
                      {stage.usesFinance && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/70">
                          <Wallet className="h-2.5 w-2.5" /> AlphaVantage / Finnhub
                        </span>
                      )}
                      {stage.id === 'risk' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-orange-400/70">
                          <Shield className="h-2.5 w-2.5" /> 10 deterministic checks
                        </span>
                      )}
                      {stage.id === 'execute' && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/70">
                          <Zap className="h-2.5 w-2.5" /> Paper / Live order
                        </span>
                      )}
                      {stage.id === 'scan' && (
                        <>
                          <span className="inline-flex items-center gap-1 text-[10px] text-gray-400/70">
                            <Globe className="h-2.5 w-2.5" /> Polymarket
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] text-gray-400/70">
                            <Globe className="h-2.5 w-2.5" /> Kalshi
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ─── Service Routing ─── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Activity className="h-4 w-4 text-amber-400" />
            Service-to-Stage Routing
          </CardTitle>
          <CardDescription className="text-gray-500">
            Which service is used at each pipeline stage, and how credentials are resolved
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Stage</th>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">LLM / Provider</th>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Search</th>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Enrichment</th>
                  <th className="pb-2 text-left text-xs font-medium text-gray-500">Depth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                <tr className="text-gray-300">
                  <td className="py-2 text-violet-400 font-medium">Triage</td>
                  <td className="py-2"><span className="text-[11px]">triageModel → defaultModel → LLM Provider</span></td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-yellow-400 font-medium">Research</td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2"><span className="text-[11px]">SearXNG → searchService override</span></td>
                  <td className="py-2"><span className="text-[11px]">Qdrant memory + extraction</span></td>
                  <td className="py-2">
                    <Badge className="text-[9px] border-yellow-500/30 bg-yellow-500/10 text-yellow-400">QUICK</Badge>
                    {' '}
                    <Badge className="text-[9px] border-blue-500/30 bg-blue-500/10 text-blue-400">DEEP</Badge>
                    {' '}
                    <Badge className="text-[9px] border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400">FULL</Badge>
                  </td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-indigo-400 font-medium">DeerFlow</td>
                  <td className="py-2"><span className="text-[11px]">deerflowApiModel / deerflowModel → DeerFlow API → LLM Provider</span></td>
                  <td className="py-2"><span className="text-[11px]">SearXNG (iterative multi-hop)</span></td>
                  <td className="py-2"><span className="text-[11px]">Qdrant → vectorDbCollection</span></td>
                  <td className="py-2">
                    <Badge className="text-[9px] border-indigo-500/30 bg-indigo-500/10 text-indigo-400">DEERFLOW</Badge>
                    {' '}
                    <Badge className="text-[9px] border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400">FULL</Badge>
                  </td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-rose-400 font-medium">TradingAgents</td>
                  <td className="py-2"><span className="text-[11px]">analystLlmProvider + analystDeepThinkLlm + analystQuickThinkLlm + analystMaxDebateRounds</span></td>
                  <td className="py-2"><span className="text-[11px]">SearXNG + Reddit + Agent-Reach social context</span></td>
                  <td className="py-2"><span className="text-[11px]">Optional AlphaVantage / Finnhub enrichment</span></td>
                  <td className="py-2">
                    <Badge className="text-[9px] border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400">FULL</Badge>
                  </td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-sky-400 font-medium">Agent-Reach</td>
                  <td className="py-2"><span className="text-[11px]">No LLM; MCP/SSE research adapter</span></td>
                  <td className="py-2"><span className="text-[11px]">Social/discussion ingestion via configured tool</span></td>
                  <td className="py-2"><span className="text-[11px]">Feeds synthesis and TradingAgents enrichment</span></td>
                  <td className="py-2">
                    <Badge className="text-[9px] border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400">FULL</Badge>
                  </td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-fuchsia-400 font-medium">Synthesis</td>
                  <td className="py-2"><span className="text-[11px]">judgeModel → defaultModel</span></td>
                  <td className="py-2"><span className="text-[11px]">Merged evidence: web + DeerFlow + TradingAgents + Agent-Reach</span></td>
                  <td className="py-2"><span className="text-[11px]">Provider provenance + disagreements</span></td>
                  <td className="py-2">
                    <Badge className="text-[9px] border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400">FULL</Badge>
                  </td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-emerald-400 font-medium">Bull</td>
                  <td className="py-2"><span className="text-[11px]">bullModel → researchModel → defaultModel</span></td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-red-400 font-medium">Bear</td>
                  <td className="py-2"><span className="text-[11px]">bearModel → researchModel → defaultModel</span></td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-amber-400 font-medium">Contradiction</td>
                  <td className="py-2"><span className="text-[11px]">contradictionModel → researchModel → defaultModel</span></td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-cyan-400 font-medium">Judge</td>
                  <td className="py-2"><span className="text-[11px]">judgeModel → defaultModel</span></td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                </tr>
                <tr className="text-gray-300">
                  <td className="py-2 text-orange-400 font-medium">Risk Engine</td>
                  <td className="py-2 text-gray-600">Deterministic (no LLM)</td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                  <td className="py-2 text-gray-600">—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] text-gray-600">
            FULL research fan-out: DeerFlow + TradingAgents + Agent-Reach in parallel, then synthesis. Model/provider resolution is configured in Strategy Hub and resolved through Credentials DB plus env fallbacks.
          </p>
        </CardContent>
      </Card>

      {/* ─── Credential Resolution ─── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <BookOpen className="h-4 w-4 text-emerald-400" />
            Credential Resolution Chain
          </CardTitle>
          <CardDescription className="text-gray-500">
            How the system resolves which credentials to use at runtime
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-xs font-medium text-gray-400">1. Stage Routing (Strategy Hub)</p>
              <p className="text-[11px] text-gray-500 mt-1">Check <code className="text-emerald-400/80">strategy_settings.stageRouting</code> for per-stage routing, depth, and provider controls such as <code className="text-emerald-400/80">researchDepth</code>, <code className="text-emerald-400/80">deerflowApiModel</code>, <code className="text-emerald-400/80">analystLlmProvider</code>, and <code className="text-emerald-400/80">agentReachEnabled</code>.</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-xs font-medium text-gray-400">2. Credentials Database</p>
              <p className="text-[11px] text-gray-500 mt-1">Look up active credential by service name with variant matching (e.g., <code className="text-blue-400/80">["llm", "LLM Provider", "OpenAI", "openai"]</code>, <code className="text-sky-400/80">["agent-reach", "Agent Reach", "AGENT_REACH"]</code>). Decrypt encrypted data and fall back to the next variant.</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-xs font-medium text-gray-400">3. Environment Variables</p>
              <p className="text-[11px] text-gray-500 mt-1">Fall back to <code className="text-cyan-400/80">OPENAI_BASE_URL</code>, <code className="text-cyan-400/80">OPENAI_API_KEY</code>, <code className="text-cyan-400/80">TA_SEARXNG_URL</code> / <code className="text-cyan-400/80">SEARXNG_URL</code>, <code className="text-cyan-400/80">AGENT_REACH_URL</code>, and vendor keys if no DB credential is found.</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-xs font-medium text-gray-400">4. Hardcoded Defaults</p>
              <p className="text-[11px] text-gray-500 mt-1">Final fallbacks are service-specific: LLM provider, DeerFlow local logic, and SearXNG local/compose defaults. Finance vendors are optional enrichments only and should not block core research.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ─── API Routes ─── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Globe className="h-4 w-4 text-blue-400" />
            API Endpoints
          </CardTitle>
          <CardDescription className="text-gray-500">
            All available REST API routes
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { method: 'GET', path: '/api/health', desc: 'DB status, service health pings, queue depth' },
              { method: 'GET', path: '/api', desc: 'Simple health check' },
              { method: 'GET|POST', path: '/api/strategy', desc: 'Strategy settings & stage routing config' },
              { method: 'GET|POST|PUT|DEL', path: '/api/credentials', desc: 'CRUD for service credentials (encrypted)' },
              { method: 'POST', path: '/api/credentials/test', desc: 'Test a credential connection' },
              { method: 'GET|POST', path: '/api/markets', desc: 'Markets with snapshots & candidates' },
              { method: 'GET', path: '/api/research', desc: 'Research runs with agent outputs & sources' },
              { method: 'GET', path: '/api/deerflow/models', desc: 'List DeerFlow API models for Strategy Hub selection' },
              { method: 'GET|POST', path: '/api/decisions', desc: 'Decisions with risk engine output' },
              { method: 'GET', path: '/api/orders', desc: 'Orders list' },
              { method: 'GET|POST|PUT', path: '/api/jobs', desc: 'Job queue (SCAN, TRIAGE, RESEARCH, etc.)' },
              { method: 'GET|POST', path: '/api/simulation', desc: 'Simulation state, live pipeline stage feed, and control' },
              { method: 'GET|POST|PUT', path: '/api/prompts', desc: 'Prompt template versioning' },
              { method: 'GET|PUT', path: '/api/settings', desc: 'Key-value settings store' },
              { method: 'GET', path: '/api/llm/models', desc: 'List available LLM models from provider' },
              { method: 'GET', path: '/api/qdrant/discover', desc: 'Discover Qdrant collections' },
              { method: 'POST', path: '/api/qdrant/auto-setup', desc: 'Auto-setup Qdrant default collections' },
            ].map((ep) => (
              <div key={ep.path} className="flex items-start gap-2 rounded border border-gray-800 bg-gray-800/20 px-2.5 py-2">
                <Badge className="shrink-0 text-[9px] font-mono border-gray-700 bg-gray-800 text-gray-400">
                  {ep.method}
                </Badge>
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-gray-300">{ep.path}</p>
                  <p className="text-[10px] text-gray-600">{ep.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
