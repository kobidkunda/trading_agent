'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  KeyRound,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Globe,
  Server,
  Cloud,
  Zap,
  ExternalLink,
  AlertTriangle,
  Link2,
  Unlink,
  Info,
  ChevronDown,
  ChevronRight,
  Database,
  Search,
  ChevronUp,
  Network,
  Save,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import { QdrantSetupWizard } from '@/components/trading/QdrantSetupWizard';
import { QDRANT_DEFAULT_COLLECTIONS } from '@/lib/constants';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

// ── Service definitions ────────────────────────────────────────────────────

interface ServiceDef {
  id: string;
  label: string;
  color: string;
  iconBg: string;
  type: 'self-hosted' | 'cloud';
  defaultUrl?: string;
  defaultPort?: number;
  description: string;
  urlPlaceholder: string;
  credentialLabel: string;
  credentialPlaceholder: string;
  docsUrl?: string;
  dockerImage?: string;
  testEndpoint?: string;
}

const SERVICES: ServiceDef[] = [
  {
    id: 'venue_proxy',
    label: 'Venue Proxy',
    color: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    type: 'self-hosted',
    defaultUrl: '',
    description: 'Reusable Netlify, Vercel, or edge proxy for market venue APIs',
    urlPlaceholder: 'https://your-proxy.netlify.app',
    credentialLabel: 'Proxy Token (optional)',
    credentialPlaceholder: 'Leave blank unless PROXY_TOKEN is set',
    testEndpoint: '/health',
  },
  {
    id: 'qdrant',
    label: 'Qdrant',
    color: 'text-orange-400',
    iconBg: 'bg-orange-500/10',
    type: 'self-hosted',
    defaultUrl: 'http://localhost:6333',
    defaultPort: 6333,
    description: 'Vector database for semantic search and RAG memory',
    urlPlaceholder: 'http://localhost:6333',
    credentialLabel: 'API Key (optional)',
    credentialPlaceholder: 'Leave blank if no auth required',
    docsUrl: 'https://qdrant.tech/documentation/',
    dockerImage: 'qdrant/qdrant:latest',
    testEndpoint: '/collections',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    color: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
    type: 'self-hosted',
    defaultUrl: 'http://localhost:11434',
    defaultPort: 11434,
    description: 'Local LLM inference server for research agents',
    urlPlaceholder: 'http://localhost:11434',
    credentialLabel: 'API Key (optional)',
    credentialPlaceholder: 'Leave blank if no auth required',
    docsUrl: 'https://ollama.com/',
    dockerImage: 'ollama/ollama:latest',
    testEndpoint: '/api/tags',
  },
  {
    id: 'searxng',
    label: 'SearXNG',
    color: 'text-teal-400',
    iconBg: 'bg-teal-500/10',
    type: 'self-hosted',
    defaultUrl: 'http://localhost:8888',
    defaultPort: 8888,
    description: 'Privacy-focused metasearch engine for web research',
    urlPlaceholder: 'http://localhost:8888',
    credentialLabel: 'API Key (optional)',
    credentialPlaceholder: 'Leave blank if no auth required',
    docsUrl: 'https://docs.searxng.org/',
    dockerImage: 'searxng/searxng:latest',
    testEndpoint: '/search',
  },
  {
    id: 'mem0',
    label: 'Mem0',
    color: 'text-pink-400',
    iconBg: 'bg-pink-500/10',
    type: 'self-hosted',
    defaultUrl: 'http://localhost:8000',
    defaultPort: 8000,
    description: 'Long-term memory layer for agent conversations',
    urlPlaceholder: 'http://localhost:8000',
    credentialLabel: 'API Key',
    credentialPlaceholder: 'Enter Mem0 API key',
    docsUrl: 'https://docs.mem0.ai/',
    dockerImage: 'mem0ai/mem0:latest',
    testEndpoint: '/health',
  },
  {
    id: 'polymarket',
    label: 'Polymarket',
    color: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    type: 'cloud',
    defaultUrl: 'https://clob.polymarket.com',
    description: 'Crypto prediction market exchange',
    urlPlaceholder: 'https://clob.polymarket.com',
    credentialLabel: 'API Key + Secret',
    credentialPlaceholder: 'Enter API key (JSON with apiKey + apiSecret)',
    docsUrl: 'https://docs.polymarket.com/',
  },
  {
    id: 'kalshi',
    label: 'Kalshi',
    color: 'text-purple-400',
    iconBg: 'bg-purple-500/10',
    type: 'cloud',
    defaultUrl: 'https://trading-api.kalshi.com',
    description: 'US-regulated prediction market exchange',
    urlPlaceholder: 'https://trading-api.kalshi.com',
    credentialLabel: 'API Credentials',
    credentialPlaceholder: 'Enter username and password (JSON)',
    docsUrl: 'https://kalshi.com/docs',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    color: 'text-cyan-400',
    iconBg: 'bg-cyan-500/10',
    type: 'cloud',
    defaultUrl: 'https://generativelanguage.googleapis.com',
    description: 'Google AI model for agent reasoning',
    urlPlaceholder: 'https://generativelanguage.googleapis.com',
    credentialLabel: 'API Key',
    credentialPlaceholder: 'Enter Gemini API key',
    docsUrl: 'https://ai.google.dev/docs',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    color: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    type: 'cloud',
    defaultUrl: 'https://api.openai.com',
    description: 'OpenAI API for GPT-based agent reasoning',
    urlPlaceholder: 'https://api.openai.com',
    credentialLabel: 'API Key',
    credentialPlaceholder: 'Enter OpenAI API key',
    docsUrl: 'https://platform.openai.com/docs',
  },
  {
    id: 'llm',
    label: 'LLM Provider',
    color: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    type: 'self-hosted',
    defaultUrl: '',
    defaultPort: 4444,
    description: 'Custom / OpenAI compatible LLM endpoint',
    urlPlaceholder: 'http://localhost:11434/v1',
    credentialLabel: 'API Key (optional)',
    credentialPlaceholder: 'Leave blank for local providers',
    testEndpoint: '/models',
  },
  {
    id: 'deerflow',
    label: 'DeerFlow Research',
    color: 'text-indigo-400',
    iconBg: 'bg-indigo-500/10',
    type: 'self-hosted',
    defaultUrl: '',
    defaultPort: 4444,
    description: 'LLM endpoint for DeerFlow deep research agent (can be same as LLM Provider or separate)',
    urlPlaceholder: 'http://localhost:11434/v1',
    credentialLabel: 'API Key (optional)',
    credentialPlaceholder: 'Leave blank for local providers',
    testEndpoint: '/models',
  },
  {
    id: 'tradingagents',
    label: 'TradingAgents',
    color: 'text-rose-400',
    iconBg: 'bg-rose-500/10',
    type: 'self-hosted',
    defaultUrl: 'http://localhost:8100',
    defaultPort: 8100,
    description: 'Multi-source analyst team (News, Sentiment, Technical, Fundamentals) via TradingAgents framework',
    urlPlaceholder: 'http://localhost:8100',
    credentialLabel: 'API Key (optional)',
    credentialPlaceholder: 'Leave blank for local Docker instance',
    testEndpoint: '/health',
  },
  {
    id: 'proxy',
    label: 'Generic Proxy App',
    color: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    type: 'cloud',
    defaultUrl: '',
    description: 'Reusable Netlify/Vercel proxy base URL for market data APIs',
    urlPlaceholder: 'https://your-proxy.netlify.app/api/polymarket',
    credentialLabel: 'Proxy Token (optional)',
    credentialPlaceholder: 'Optional shared proxy token',
    testEndpoint: '/health',
  },
  {
    id: 'polymarket_proxy',
    label: 'Polymarket Proxy',
    color: 'text-sky-400',
    iconBg: 'bg-sky-500/10',
    type: 'cloud',
    defaultUrl: '',
    description: 'Proxy URL used by the Polymarket scanner and orderbook fetcher',
    urlPlaceholder: 'https://your-proxy.netlify.app/api/polymarket',
    credentialLabel: 'Proxy Token (optional)',
    credentialPlaceholder: 'Optional shared proxy token',
    testEndpoint: '/health',
  },
  {
    id: 'kalshi_proxy',
    label: 'Kalshi Proxy',
    color: 'text-violet-400',
    iconBg: 'bg-violet-500/10',
    type: 'cloud',
    defaultUrl: '',
    description: 'Proxy URL used by Kalshi market discovery',
    urlPlaceholder: 'https://your-proxy.netlify.app/api/kalshi',
    credentialLabel: 'Proxy Token (optional)',
    credentialPlaceholder: 'Optional shared proxy token',
    testEndpoint: '/health',
  },
  {
    id: 'sxbet_proxy',
    label: 'SX Bet Proxy',
    color: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
    type: 'cloud',
    defaultUrl: '',
    description: 'Proxy URL reserved for SX Bet data integrations',
    urlPlaceholder: 'https://your-proxy.netlify.app/api/sxbet',
    credentialLabel: 'Proxy Token (optional)',
    credentialPlaceholder: 'Optional shared proxy token',
    testEndpoint: '/health',
  },
  {
    id: 'manifold_proxy',
    label: 'Manifold Proxy',
    color: 'text-fuchsia-400',
    iconBg: 'bg-fuchsia-500/10',
    type: 'cloud',
    defaultUrl: '',
    description: 'Proxy URL reserved for Manifold market data integrations',
    urlPlaceholder: 'https://your-proxy.netlify.app/api/manifold',
    credentialLabel: 'Proxy Token (optional)',
    credentialPlaceholder: 'Optional shared proxy token',
    testEndpoint: '/health',
  },
  {
    id: 'mirofish',
    label: 'MiroFish',
    color: 'text-cyan-400',
    iconBg: 'bg-cyan-500/10',
    type: 'self-hosted',
    defaultUrl: '',
    defaultPort: 5401,
    description: 'Multi-model LLM gateway for post-debate predictions (80+ models)',
    urlPlaceholder: 'http://localhost:5401',
    credentialLabel: 'API Key (optional)',
    credentialPlaceholder: 'Leave blank if no auth required',
    testEndpoint: '/health',
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    color: 'text-orange-400',
    iconBg: 'bg-orange-500/10',
    type: 'cloud',
    defaultUrl: 'https://api.firecrawl.dev',
    description: 'Web scraping & deep research API for DeerFlow fallback',
    urlPlaceholder: 'https://api.firecrawl.dev',
    credentialLabel: 'API Key',
    credentialPlaceholder: 'Enter Firecrawl API key (fc-...)',
    docsUrl: 'https://docs.firecrawl.dev',
  },
  {
    id: 'agent_reach',
    label: 'Agent-Reach',
    color: 'text-violet-400',
    iconBg: 'bg-violet-500/10',
    type: 'self-hosted',
    defaultUrl: 'http://localhost:8200',
    defaultPort: 8200,
    description: 'Web content fetch & summarization for research pipeline',
    urlPlaceholder: 'http://localhost:8200',
    credentialLabel: 'API Key',
    credentialPlaceholder: 'Enter Agent-Reach API key',
    testEndpoint: '/health',
  },
];

function getServiceDef(serviceId: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.id === serviceId || s.label.toLowerCase() === serviceId.toLowerCase());
}

// ── Types ──────────────────────────────────────────────────────────────────

interface Credential {
  id: string;
  service: string;
  label: string;
  maskedPreview: string | null;
  serviceUrl: string | null;
  isActive: boolean;
  lastTestedAt: string | null;
  testResult: string | null;
  testDetails: string | null;
}

type ProxyVenue = 'polymarket' | 'kalshi' | 'sxBet' | 'manifold';

interface VenueProxyProfile {
  id: string;
  label: string;
  baseUrl?: string;
  token?: string;
  urls: Partial<Record<ProxyVenue, string>>;
  isActive: boolean;
}

interface VenueProxySettings {
  activeProfileId: string | null;
  profiles: VenueProxyProfile[];
}

const PROXY_VENUES: Array<{ key: ProxyVenue; label: string; path: string; placeholder: string }> = [
  { key: 'polymarket', label: 'Polymarket', path: 'clob', placeholder: 'https://proxy.example.com/clob' },
  { key: 'kalshi', label: 'Kalshi', path: 'kalshi', placeholder: 'https://proxy.example.com/kalshi' },
  { key: 'sxBet', label: 'SX Bet', path: 'sx-bet', placeholder: 'https://proxy.example.com/sx-bet' },
  { key: 'manifold', label: 'Manifold', path: 'manifold', placeholder: 'https://proxy.example.com/manifold' },
];

function adminFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    headers: {
      'x-role': 'Admin',
      ...(init.headers || {}),
    },
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusBadge({ testResult }: { testResult: string | null }) {
  switch (testResult) {
    case 'SUCCESS':
      return (
        <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          Connected
        </Badge>
      );
    case 'FAILED':
      return (
        <Badge className="gap-1 border-red-500/30 bg-red-500/10 text-red-400">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    default:
      return (
        <Badge className="gap-1 border-gray-500/30 bg-gray-500/10 text-gray-400">
          <HelpCircle className="h-3 w-3" />
          Untested
        </Badge>
      );
  }
}

function TypeBadge({ type }: { type: 'self-hosted' | 'cloud' }) {
  if (type === 'self-hosted') {
    return (
      <Badge variant="outline" className="gap-1 border-orange-500/30 bg-orange-500/5 text-[10px] text-orange-400">
        <Server className="h-2.5 w-2.5" />
        Self-Hosted
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-blue-500/30 bg-blue-500/5 text-[10px] text-blue-400">
      <Cloud className="h-2.5 w-2.5" />
      Cloud
    </Badge>
  );
}

// ── Add Credential Dialog ──────────────────────────────────────────────────

function AddCredentialDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (cred: Credential) => void;
}) {
  const [selectedService, setSelectedService] = useState('');
  const [label, setLabel] = useState('');
  const [serviceUrl, setServiceUrl] = useState('');
  const [credentialValue, setCredentialValue] = useState('');
  const [saving, setSaving] = useState(false);

  const serviceDef = getServiceDef(selectedService);

  // When service changes, set defaults
  useEffect(() => {
    if (serviceDef) {
      setServiceUrl(serviceDef.defaultUrl || '');
      setLabel('');
      setCredentialValue('');
    }
  }, [selectedService, serviceDef]);

  const canSave = selectedService && label.trim() && serviceUrl.trim();

  const handleSave = useCallback(async () => {
    if (!canSave || !serviceDef) return;
    setSaving(true);
    try {
      const res = await adminFetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: serviceDef.id,
          label: label.trim(),
          encryptedData: credentialValue.trim() ? JSON.stringify({ apiKey: credentialValue.trim() }) : JSON.stringify({}),
          serviceUrl: serviceUrl.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        onAdded({
          id: data.id,
          service: data.service,
          label: data.label,
          maskedPreview: data.maskedPreview,
          serviceUrl: data.serviceUrl,
          isActive: data.isActive ?? true,
          lastTestedAt: data.lastTestedAt,
          testResult: data.testResult,
          testDetails: data.testDetails,
        });
        toast.success(`${serviceDef.label} credential added`);
        onOpenChange(false);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to add credential');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }, [canSave, serviceDef, label, serviceUrl, credentialValue, onAdded, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-gray-800 bg-gray-900 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Credential</DialogTitle>
          <DialogDescription className="text-gray-500">
            Configure a service connection. Self-hosted services need a local URL.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Service selection with descriptions */}
          <div className="space-y-2">
            <Label className="text-gray-300">Service</Label>
            <Select value={selectedService} onValueChange={setSelectedService}>
              <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                <SelectValue placeholder="Select a service..." />
              </SelectTrigger>
              <SelectContent className="border-gray-700 bg-gray-900 max-h-72">
                {/* Self-hosted section */}
                <div className="px-2 pt-2 pb-1">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-orange-400/70">
                    <Server className="h-3 w-3" />
                    Self-Hosted
                  </p>
                </div>
                {SERVICES.filter((s) => s.type === 'self-hosted').map((s) => (
                  <SelectItem key={s.id} value={s.id} className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-xs font-medium', s.color)}>{s.label}</span>
                      <span className="text-[10px] text-gray-600">{s.description}</span>
                    </div>
                  </SelectItem>
                ))}
                {/* Proxy Apps section */}
                <div className="px-2 pt-2 pb-1">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/70">
                    <Link2 className="h-3 w-3" />
                    Proxy Apps (Netlify / Vercel)
                  </p>
                </div>
                {SERVICES.filter((s) => s.type === 'cloud' && s.id.includes('proxy')).map((s) => (
                  <SelectItem key={s.id} value={s.id} className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-xs font-medium', s.color)}>{s.label}</span>
                      <span className="text-[10px] text-gray-600">{s.description}</span>
                    </div>
                  </SelectItem>
                ))}
                {/* Cloud section */}
                <div className="px-2 pt-2 pb-1">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-400/70">
                    <Cloud className="h-3 w-3" />
                    Cloud APIs
                  </p>
                </div>
                {SERVICES.filter((s) => s.type === 'cloud' && !s.id.includes('proxy')).map((s) => (
                  <SelectItem key={s.id} value={s.id} className="py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-xs font-medium', s.color)}>{s.label}</span>
                      <span className="text-[10px] text-gray-600">{s.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Service info card */}
            {serviceDef && (
              <div className={cn('rounded-lg border px-3 py-2.5', serviceDef.type === 'self-hosted' ? 'border-orange-500/20 bg-orange-500/5' : 'border-blue-500/20 bg-blue-500/5')}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TypeBadge type={serviceDef.type} />
                    {serviceDef.dockerImage && (
                      <Badge variant="outline" className="border-gray-700 text-[9px] text-gray-500 font-mono">
                        {serviceDef.dockerImage}
                      </Badge>
                    )}
                  </div>
                  {serviceDef.docsUrl && (
                    <a
                      href={serviceDef.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      Docs <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-gray-400">{serviceDef.description}</p>
              </div>
            )}
          </div>

          {/* Service URL */}
          <div className="space-y-2">
            <Label className="text-gray-300 flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-gray-500" />
              {serviceDef?.id.includes('proxy') ? 'Proxy URL' : 'Service URL'}
              {serviceDef?.type === 'self-hosted' && (
                <span className="text-[10px] text-orange-400">(required for self-hosted)</span>
              )}
              {serviceDef?.id.includes('proxy') && (
                <span className="text-[10px] text-emerald-400">(deployed proxy base URL)</span>
              )}
            </Label>
            <Input
              value={serviceUrl}
              onChange={(e) => setServiceUrl(e.target.value)}
              placeholder={serviceDef?.urlPlaceholder || 'https://...'}
              className="border-gray-700 bg-gray-800 text-white placeholder:text-gray-600 font-mono text-sm"
            />
            {serviceDef?.defaultPort && (
              <p className="text-[10px] text-gray-600">
                Default port: {serviceDef.defaultPort}
              </p>
            )}
            {serviceDef?.id.includes('proxy') && (
              <p className="flex items-center gap-1 text-[10px] text-gray-500">
                <Info className="h-3 w-3 shrink-0" />
                Deploy <code className="text-emerald-400 mx-0.5">apps/proxyapp</code> to Netlify or Vercel, then paste the URL here. See{' '}
                <span className="text-gray-400 font-mono">apps/proxyapp/HELP.md</span> for one-command deploy.
              </p>
            )}
          </div>

          <Separator className="bg-gray-800" />

          {/* Label */}
          <div className="space-y-2">
            <Label className="text-gray-300">Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={serviceDef ? `e.g. ${serviceDef.label} - ${serviceDef.type === 'self-hosted' ? 'Local' : 'Production'}` : 'e.g. Production API Key'}
              className="border-gray-700 bg-gray-800 text-white placeholder:text-gray-600"
            />
          </div>

          {/* Credential value */}
          <div className="space-y-2">
            <Label className="text-gray-300">
              {serviceDef?.credentialLabel || 'Credential Value'}
            </Label>
            <Input
              type="password"
              value={credentialValue}
              onChange={(e) => setCredentialValue(e.target.value)}
              placeholder={serviceDef?.credentialPlaceholder || 'Enter API key or token'}
              className="border-gray-700 bg-gray-800 text-white placeholder:text-gray-600"
            />
            {serviceDef?.type === 'self-hosted' && !credentialValue && (
              <p className="flex items-center gap-1 text-[10px] text-gray-600">
                <Info className="h-3 w-3" />
                Some self-hosted services don't need auth — you can leave this blank
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-gray-400">
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Add Credential
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ────────────────────────────────────────────────────────

export function CredentialManager() {
  const [testingId, setTestingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Credential | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardCredId, setWizardCredId] = useState<string | null>(null);
  const [qdrantCollectionLinks, setQdrantCollectionLinks] = useState<Record<string, Record<string, string>>>({});
  const [autoSetupCredId, setAutoSetupCredId] = useState<string | null>(null);
  const [autoSetupRunning, setAutoSetupRunning] = useState(false);
  const [autoSetupResults, setAutoSetupResults] = useState<Array<{ key: string; name: string; created: boolean; skipped: boolean; error: string | null }> | null>(null);
  const [proxySettings, setProxySettings] = useState<VenueProxySettings>({ activeProfileId: null, profiles: [] });
  const [proxyDraft, setProxyDraft] = useState<VenueProxyProfile>({
    id: '',
    label: 'Netlify Proxy',
    baseUrl: '',
    urls: {},
    isActive: true,
  });
  const [savingProxy, setSavingProxy] = useState(false);

  // Search state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data: credentials,
    page,
    limit,
    total,
    totalPages,
    sortBy,
    sortOrder,
    loading,
    error,
    setPage,
    setLimit,
    setSort,
    fetchData,
  } = usePagination<Credential>(
    async (params: PaginationParams): Promise<PaginatedResponse<Credential>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: (params.sortBy as string) || 'createdAt',
        sortOrder: params.sortOrder || 'desc',
      });
      if (debouncedSearch.trim()) query.set('search', debouncedSearch.trim());

      const res = await adminFetch(`/api/credentials?${query}`);
      if (!res.ok) throw new Error('Failed to fetch credentials');
      return res.json();
    },
    [debouncedSearch],
    { defaultSortBy: 'createdAt', defaultSortOrder: 'desc' },
  );

  useEffect(() => {
    async function fetchQdrantLinks() {
      try {
        const res = await adminFetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          const linkMap: Record<string, Record<string, string>> = {};
          for (const setting of data.settings || []) {
            const match = setting.key.match(/^qdrant_collections_(.+)$/);
            if (match) {
              try {
                linkMap[match[1]] = JSON.parse(setting.value);
              } catch {}
            }
          }
          setQdrantCollectionLinks(linkMap);
        }
      } catch {}
    }
    fetchQdrantLinks();
  }, []);

  const testConnection = useCallback(async (cred: Credential) => {
    setTestingId(cred.id);
    try {
      const res = await adminFetch(`/api/credentials/test?id=${cred.id}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        fetchData();
        if (data.testResult === 'SUCCESS') {
          toast.success(`${cred.service}: Connected`, { description: data.details });
        } else {
          toast.error(`${cred.service}: Test Failed`, {
            description: data.details,
            duration: 8000,
          });
        }
      } else {
        toast.error(`Failed to test ${cred.service}`);
      }
    } catch {
      toast.error('Network error during test');
    } finally {
      setTestingId(null);
    }
  }, [fetchData]);

  const addCredential = useCallback((cred: Credential) => {
    fetchData();
  }, [fetchData]);

  const runAutoSetup = useCallback(async (credId: string) => {
    setAutoSetupCredId(credId);
    setAutoSetupRunning(true);
    setAutoSetupResults(null);
    try {
      const res = await adminFetch('/api/qdrant/auto-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: credId }),
      });
      if (res.ok) {
        const data = await res.json();
        setAutoSetupResults(data.results || []);
        const links = data.links || {};
        setQdrantCollectionLinks((prev) => ({ ...prev, [credId]: links }));
        const created = (data.results || []).filter((r: { created: boolean }) => r.created).length;
        const skipped = (data.results || []).filter((r: { skipped: boolean }) => r.skipped).length;
        const errors = (data.results || []).filter((r: { error: string | null }) => r.error).length;
        if (errors > 0) {
          toast.warning(`Setup completed with ${errors} error(s)`, { description: `${created} created, ${skipped} already existed` });
        } else if (created > 0) {
          toast.success(`${created} collection(s) created`, { description: `${skipped} already existed` });
        } else {
          toast.success('All collections already configured');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Auto-setup failed');
        setAutoSetupResults(null);
      }
    } catch {
      toast.error('Network error during auto-setup');
      setAutoSetupResults(null);
    } finally {
      setAutoSetupRunning(false);
    }
  }, []);

  const deleteCredential = useCallback(async (cred: Credential) => {
    try {
      await adminFetch(`/api/credentials?id=${cred.id}`, { method: 'DELETE' });
      fetchData();
    } catch {
      // ignore
    }
    setDeleteTarget(null);
    toast.success(`${cred.service} credential removed`);
  }, [fetchData]);

  useEffect(() => {
    async function fetchProxySettings() {
      try {
        const res = await adminFetch('/api/proxy-settings');
        if (!res.ok) return;
        const data = await res.json() as VenueProxySettings;
        setProxySettings(data);
        const active = data.profiles.find((profile) => profile.id === data.activeProfileId) || data.profiles[0];
        if (active) {
          setProxyDraft(active);
        }
      } catch {}
    }
    fetchProxySettings();
  }, []);

  const updateProxyBaseUrl = useCallback((value: string) => {
    const baseUrl = value.trim().replace(/\/$/, '');
    setProxyDraft((prev) => ({
      ...prev,
      baseUrl,
      urls: baseUrl
        ? Object.fromEntries(PROXY_VENUES.map((venue) => [venue.key, `${baseUrl}/${venue.path}`])) as Partial<Record<ProxyVenue, string>>
        : prev.urls,
    }));
  }, []);

  const saveProxyProfile = useCallback(async () => {
    const id = proxyDraft.id || `proxy-${Date.now()}`;
    const profile: VenueProxyProfile = {
      ...proxyDraft,
      id,
      label: proxyDraft.label.trim() || 'Venue Proxy',
      isActive: true,
      urls: Object.fromEntries(
        PROXY_VENUES.map((venue) => [venue.key, (proxyDraft.urls[venue.key] || '').trim().replace(/\/$/, '')]),
      ) as Partial<Record<ProxyVenue, string>>,
    };
    const profiles = [
      profile,
      ...proxySettings.profiles.filter((item) => item.id !== id).map((item) => ({ ...item, isActive: false })),
    ];
    setSavingProxy(true);
    try {
      const res = await adminFetch('/api/proxy-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeProfileId: id, profiles }),
      });
      if (!res.ok) throw new Error('Save failed');
      const saved = await res.json() as VenueProxySettings;
      setProxySettings(saved);
      setProxyDraft(saved.profiles.find((item) => item.id === saved.activeProfileId) || profile);
      toast.success('Venue proxy settings saved');
    } catch {
      toast.error('Failed to save venue proxy settings');
    } finally {
      setSavingProxy(false);
    }
  }, [proxyDraft, proxySettings.profiles]);

  if (loading && credentials.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Credentials</h2>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-900" />
        ))}
      </div>
    );
  }

  if (error && credentials.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Credential Manager</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button variant="outline" size="sm" className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800" onClick={fetchData}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const successCount = credentials.filter((c) => c.testResult === 'SUCCESS').length;
  const failedCount = credentials.filter((c) => c.testResult === 'FAILED').length;
  const untestedCount = credentials.filter((c) => !c.testResult).length;
  const selfHostedCount = credentials.filter((c) => {
    const def = getServiceDef(c.service);
    return def?.type === 'self-hosted';
  }).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Credential Manager</h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage API keys and self-hosted service connections
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <Input
              placeholder="Search credentials..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48 border-gray-700 bg-gray-800 pl-8 text-xs text-white placeholder:text-gray-600"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              {successCount} connected
            </span>
            {failedCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                {failedCount} failed
              </span>
            )}
            {untestedCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-gray-500" />
                {untestedCount} untested
              </span>
            )}
          </div>

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                Add Credential
              </Button>
            </DialogTrigger>
          </Dialog>

          <AddCredentialDialog open={addOpen} onOpenChange={setAddOpen} onAdded={addCredential} />
        </div>
      </div>

      {/* Quick stats bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-3">
            <p className="text-[11px] text-gray-500">Total Services</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-white">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-3">
            <p className="text-[11px] text-gray-500">Self-Hosted</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-orange-400">{selfHostedCount}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-3">
            <p className="text-[11px] text-gray-500">Connected</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-400">{successCount}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-3">
            <p className="text-[11px] text-gray-500">Failed</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-red-400">{failedCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Network className="h-4 w-4 text-emerald-400" />
            Venue Proxy URLs
          </CardTitle>
          <CardDescription className="text-xs text-gray-500">
            Active proxy profile used by Polymarket, Kalshi, SX Bet, and Manifold adapters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Profile</Label>
              <Input
                value={proxyDraft.label}
                onChange={(e) => setProxyDraft((prev) => ({ ...prev, label: e.target.value }))}
                className="h-8 border-gray-700 bg-gray-800 text-sm text-white"
                placeholder="Netlify Proxy"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Base URL</Label>
              <Input
                value={proxyDraft.baseUrl || ''}
                onChange={(e) => updateProxyBaseUrl(e.target.value)}
                className="h-8 border-gray-700 bg-gray-800 font-mono text-xs text-white"
                placeholder="https://your-proxy.netlify.app"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={saveProxyProfile}
                disabled={savingProxy}
                className="h-8 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {savingProxy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {PROXY_VENUES.map((venue) => (
              <div key={venue.key} className="space-y-1.5">
                <Label className="text-xs text-gray-400">{venue.label}</Label>
                <Input
                  value={proxyDraft.urls[venue.key] || ''}
                  onChange={(e) => setProxyDraft((prev) => ({
                    ...prev,
                    urls: { ...prev.urls, [venue.key]: e.target.value },
                  }))}
                  className="h-8 border-gray-700 bg-gray-800 font-mono text-xs text-white"
                  placeholder={venue.placeholder}
                />
              </div>
            ))}
          </div>
          {proxySettings.profiles.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {proxySettings.profiles.map((profile) => (
                <Button
                  key={profile.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setProxyDraft(profile)}
                  className={cn(
                    'h-7 border-gray-700 px-2 text-xs text-gray-400 hover:bg-gray-800',
                    profile.id === proxySettings.activeProfileId && 'border-emerald-500/40 text-emerald-400',
                  )}
                >
                  {profile.label}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available self-hosted services (quick add) */}
      {credentials.length === 0 && (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <KeyRound className="h-7 w-7 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-400">No credentials configured</p>
            <p className="mt-1 max-w-md text-center text-xs text-gray-600">
              Add self-hosted services (Qdrant, Ollama, SearXNG, Mem0) with their local URL,
              or cloud APIs (Polymarket, Kalshi, Gemini, OpenAI) with their API keys.
            </p>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button
                  size="sm"
                  className="mt-4 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4" />
                  Add Credential
                </Button>
              </DialogTrigger>
            </Dialog>
          </CardContent>
        </Card>
      )}

      {/* Credential cards */}
      {credentials.length > 0 && (
        <>
          <div className="space-y-3">
          {credentials.map((cred) => {
            const serviceDef = getServiceDef(cred.service);
            const isExpanded = expandedId === cred.id;
            const isTesting = testingId === cred.id;

            return (
              <Card
                key={cred.id}
                className={cn(
                  'border-gray-800 bg-gray-900 transition-all',
                  cred.testResult === 'SUCCESS' && 'border-emerald-500/20',
                  cred.testResult === 'FAILED' && 'border-red-500/20',
                )}
              >
                {/* Main row */}
                <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  {/* Expand toggle */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : cred.id)}
                    className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  {/* Service icon */}
                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', serviceDef?.iconBg ?? 'bg-gray-800')}>
                    {serviceDef?.type === 'self-hosted' ? (
                      <Server className={cn('h-4 w-4', serviceDef?.color ?? 'text-gray-400')} />
                    ) : (
                      <Cloud className={cn('h-4 w-4', serviceDef?.color ?? 'text-gray-400')} />
                    )}
                  </div>

                  {/* Service info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm font-semibold', serviceDef?.color ?? 'text-gray-200')}>
                        {serviceDef?.label ?? cred.service}
                      </p>
                      <TypeBadge type={serviceDef?.type ?? 'cloud'} />
                      <StatusBadge testResult={cred.testResult} />
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">{cred.label}</p>
                  </div>

                  {/* URL badge / failure reason */}
                  {cred.testResult === 'FAILED' && cred.testDetails ? (
                    <span className="hidden sm:flex items-center gap-1.5 max-w-[300px] text-[10px] text-red-400/80 truncate">
                      <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{cred.testDetails}</span>
                    </span>
                  ) : cred.serviceUrl ? (
                    <Badge variant="outline" className="hidden sm:flex gap-1 border-gray-700 text-[10px] text-gray-400 font-mono max-w-[250px]">
                      <Link2 className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">{cred.serviceUrl}</span>
                    </Badge>
                  ) : null}

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 px-2.5 text-xs text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300"
                      onClick={() => testConnection(cred)}
                      disabled={isTesting}
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span className="hidden sm:inline">Testing...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Test</span>
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
                      onClick={() => setDeleteTarget(cred)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-gray-800/50 px-4 py-4 sm:px-5 space-y-3">
                    {/* Service description */}
                    {serviceDef && (
                      <p className="text-xs text-gray-400 leading-relaxed">{serviceDef.description}</p>
                    )}

                    {/* Details grid */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      {/* Service URL */}
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                          <Globe className="h-3 w-3" />
                          Service URL
                        </p>
                        {cred.serviceUrl ? (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <code className="truncate text-xs font-mono text-gray-300">{cred.serviceUrl}</code>
                            <a
                              href={cred.serviceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-gray-600 hover:text-gray-300"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-xs text-gray-600 flex items-center gap-1">
                            <Unlink className="h-3 w-3" />
                            No URL configured
                          </p>
                        )}
                      </div>

                      {/* Credential preview */}
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                          <KeyRound className="h-3 w-3" />
                          Credential
                        </p>
                        <code className="mt-1.5 block text-xs font-mono text-gray-400">
                          {cred.maskedPreview || '****'}
                        </code>
                      </div>

                      {/* Test info */}
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                          <RefreshCw className="h-3 w-3" />
                          Last Test
                        </p>
                        <p className="mt-1.5 text-xs text-gray-400">
                          {formatRelativeTime(cred.lastTestedAt)}
                        </p>
                        {cred.testDetails && (
                          <p className="mt-1 text-[10px] text-gray-600 leading-relaxed">
                            {cred.testDetails}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Self-hosted info */}
                    {serviceDef?.type === 'self-hosted' && (
                      <div className="flex items-start gap-2 rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2.5">
                        <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" />
                        <div className="text-[11px] text-orange-400/80 space-y-0.5">
                          <p>
                            <span className="font-medium">Self-hosted service</span>
                            {serviceDef.dockerImage && (
                              <span> — Docker: <code className="font-mono">{serviceDef.dockerImage}</code></span>
                            )}
                          </p>
                          {!cred.serviceUrl && (
                            <p className="flex items-center gap-1 text-amber-400/80">
                              <AlertTriangle className="h-3 w-3" />
                              No URL configured — add the service URL to enable connection testing
                            </p>
                          )}
                          {serviceDef.docsUrl && (
                            <a
                              href={serviceDef.docsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-orange-300 hover:underline"
                            >
                              View documentation <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {serviceDef?.id === 'qdrant' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <Database className="h-3.5 w-3.5 shrink-0 text-orange-400" />
                            <div className="flex items-center gap-1.5">
                              {QDRANT_DEFAULT_COLLECTIONS.map((def) => {
                                const links = qdrantCollectionLinks[cred.id];
                                const isLinked = links && links[def.key];
                                return (
                                  <button
                                    key={def.key}
                                    title={`${def.defaultName}: ${isLinked ? 'Linked' : 'Not linked'}`}
                                    className={cn(
                                      'h-3 w-3 rounded-full transition-colors',
                                      isLinked ? 'bg-emerald-400' : 'bg-gray-700 hover:bg-gray-600'
                                    )}
                                  />
                                );
                              })}
                            </div>
                            <span className="text-[10px] text-gray-600">
                              {Object.keys(qdrantCollectionLinks[cred.id] || {}).length}/{QDRANT_DEFAULT_COLLECTIONS.length} linked
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {Object.keys(qdrantCollectionLinks[cred.id] || {}).length < QDRANT_DEFAULT_COLLECTIONS.length && cred.testResult === 'SUCCESS' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1.5 px-2 text-[11px] text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                                disabled={autoSetupRunning && autoSetupCredId === cred.id}
                                onClick={() => runAutoSetup(cred.id)}
                              >
                                {autoSetupRunning && autoSetupCredId === cred.id ? (
                                  <><Loader2 className="h-3 w-3 animate-spin" /> Setting up...</>
                                ) : (
                                  <><Zap className="h-3 w-3" /> Auto-Setup</>
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 px-2 text-[11px] text-orange-400 hover:bg-orange-500/10 hover:text-orange-300"
                              onClick={() => {
                                setWizardCredId(cred.id);
                                setWizardOpen(true);
                              }}
                            >
                              <Database className="h-3 w-3" />
                              Manage
                            </Button>
                          </div>
                        </div>
                        {autoSetupCredId === cred.id && autoSetupResults && (
                          <div className="space-y-1 rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2">
                            {autoSetupResults.map((r) => (
                              <div key={r.key} className="flex items-center gap-2 text-[11px]">
                                {r.created ? (
                                  <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                                ) : r.skipped ? (
                                  <Link2 className="h-3 w-3 shrink-0 text-gray-500" />
                                ) : (
                                  <XCircle className="h-3 w-3 shrink-0 text-red-400" />
                                )}
                                <span className={cn('font-mono', r.created ? 'text-emerald-400' : r.skipped ? 'text-gray-500' : 'text-red-400')}>
                                  {r.name}
                                </span>
                                <span className="text-gray-600">
                                  {r.created ? '(created)' : r.skipped ? '(already exists)' : r.error}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Test details for failed connections */}
                    {cred.testResult === 'FAILED' && cred.testDetails && (
                      <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                        <div className="text-[11px]">
                          <p className="font-medium text-red-400">Connection Test Failed</p>
                          <p className="mt-0.5 text-red-400/70">{cred.testDetails}</p>
                          <p className="mt-1 text-gray-600">
                            Check that the service is running at the configured URL and that any required authentication is set up.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Success details */}
                    {cred.testResult === 'SUCCESS' && cred.testDetails && (
                      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        <div className="text-[11px]">
                          <p className="font-medium text-emerald-400">Connection Verified</p>
                          <p className="mt-0.5 text-emerald-400/70">{cred.testDetails}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-gray-800 pt-3 mt-3">
            <span className="text-xs text-gray-500">
              Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total} credentials
            </span>
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
            )}
            <PaginationBar page={page} totalPages={totalPages} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
          </div>
        </>
      )}

      {wizardCredId && (
        <QdrantSetupWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          credentialId={wizardCredId}
          onCollectionsLinked={async () => {
            try {
              const res = await adminFetch('/api/settings');
              if (res.ok) {
                const data = await res.json();
                const linkMap: Record<string, Record<string, string>> = {};
                for (const setting of data.settings || []) {
                  const match = setting.key.match(/^qdrant_collections_(.+)$/);
                  if (match) {
                    try {
                      linkMap[match[1]] = JSON.parse(setting.value);
                    } catch {}
                  }
                }
                setQdrantCollectionLinks(linkMap);
              }
            } catch {}
          }}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent className="border-gray-800 bg-gray-900 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Credential</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500">
              Are you sure you want to delete the{' '}
              <span className="font-medium text-gray-300">{deleteTarget?.service}</span> credential &ldquo;
              <span className="font-medium text-gray-300">{deleteTarget?.label}</span>&rdquo;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-gray-400">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => deleteTarget && deleteCredential(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
