'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Plus,
  Link2,
  Unlink,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  QDRANT_DEFAULT_COLLECTIONS,
  EMBEDDING_PROVIDER_OPTIONS,
} from '@/lib/constants';
import type {
  EmbeddingProvider,
  QdrantDistanceMetric,
  QdrantDiscoverResult,
} from '@/lib/types';

interface QdrantSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentialId: string;
  onCollectionsLinked?: () => void;
}

type WizardStep = 'discovery' | 'configure' | 'create';

interface MissingCollectionConfig {
  key: string;
  defaultName: string;
  description: string;
  name: string;
  vectorSize: number;
  distance: QdrantDistanceMetric;
  payloadIndexes: string[];
  creating: boolean;
  created: boolean;
  error: string | null;
}

export function QdrantSetupWizard({
  open,
  onOpenChange,
  credentialId,
  onCollectionsLinked,
}: QdrantSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('discovery');
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<QdrantDiscoverResult | null>(null);
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>('openai');
  const [customDims, setCustomDims] = useState(512);
  const [missingConfigs, setMissingConfigs] = useState<MissingCollectionConfig[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open && credentialId) {
      setStep('discovery');
      setDiscoverResult(null);
      setMissingConfigs([]);
      runDiscovery();
    }
  }, [open, credentialId]);

  const runDiscovery = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await fetch('/api/qdrant/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId }),
      });
      if (res.ok) {
        const data: QdrantDiscoverResult = await res.json();
        setDiscoverResult(data);
        buildMissingConfigs(data, embeddingProvider, customDims);
      } else {
        toast.error('Discovery failed');
      }
    } catch {
      toast.error('Network error during discovery');
    } finally {
      setDiscovering(false);
    }
  }, [credentialId, embeddingProvider, customDims]);

  const buildMissingConfigs = (result: QdrantDiscoverResult, provider: EmbeddingProvider, dims: number) => {
    const providerDefaults = EMBEDDING_PROVIDER_OPTIONS.find((p) => p.value === provider);
    const vectorSize = providerDefaults?.value === 'custom' ? dims : (providerDefaults?.defaultDims || 1536);

    const missing: MissingCollectionConfig[] = [];
    for (const def of QDRANT_DEFAULT_COLLECTIONS) {
      const expected = result.expectedDefaults[def.key];
      if (!expected?.found) {
        missing.push({
          key: def.key,
          defaultName: def.defaultName,
          description: def.description,
          name: def.defaultName,
          vectorSize,
          distance: 'Cosine',
          payloadIndexes: def.payloadIndexes,
          creating: false,
          created: false,
          error: null,
        });
      }
    }
    setMissingConfigs(missing);
  };

  useEffect(() => {
    if (discoverResult) {
      buildMissingConfigs(discoverResult, embeddingProvider, customDims);
    }
  }, [embeddingProvider, customDims]);

  const allFound = discoverResult
    ? QDRANT_DEFAULT_COLLECTIONS.every((def) => discoverResult.expectedDefaults[def.key]?.found)
    : false;

  const canGoNext = step === 'discovery' && !allFound && discoverResult?.connected;
  const canCreate = step === 'configure' && missingConfigs.length > 0 && missingConfigs.every((c) => c.name.trim() && c.vectorSize > 0);

  const handleCreate = useCallback(async () => {
    setCreating(true);

    const updatedConfigs = [...missingConfigs];

    for (let i = 0; i < updatedConfigs.length; i++) {
      const config = updatedConfigs[i];
      updatedConfigs[i] = { ...config, creating: true, error: null };
      setMissingConfigs([...updatedConfigs]);

      try {
        const res = await fetch('/api/qdrant/collections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credentialId,
            name: config.name,
            vectorSize: config.vectorSize,
            distance: config.distance,
            payloadIndexes: config.payloadIndexes,
          }),
        });

        if (res.ok) {
          updatedConfigs[i] = { ...updatedConfigs[i], creating: false, created: true };
        } else {
          const err = await res.json().catch(() => ({}));
          updatedConfigs[i] = { ...updatedConfigs[i], creating: false, created: false, error: err.error || 'Create failed' };
        }
      } catch {
        updatedConfigs[i] = { ...updatedConfigs[i], creating: false, created: false, error: 'Network error' };
      }

      setMissingConfigs([...updatedConfigs]);
    }

    const allCreated = updatedConfigs.every((c) => c.created);
    if (allCreated) {
      const links: Record<string, string> = {};
      for (const def of QDRANT_DEFAULT_COLLECTIONS) {
        const found = discoverResult?.expectedDefaults[def.key];
        if (found?.found && found.name) {
          links[def.key] = found.name;
        } else {
          const config = updatedConfigs.find((c) => c.key === def.key);
          if (config) links[def.key] = config.name;
        }
      }

      try {
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: `qdrant_collections_${credentialId}`, value: JSON.stringify(links) }),
        });
      } catch {}

      toast.success('All collections created and linked');
      onCollectionsLinked?.();
    }

    setCreating(false);
  }, [missingConfigs, credentialId, discoverResult, onCollectionsLinked]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-gray-800 bg-gray-900 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-orange-400" />
            Qdrant Collection Setup
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            Auto-discover and configure Qdrant vector collections
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-xs">
          {(['discovery', 'configure', 'create'] as WizardStep[]).map((s, i) => {
            const isActive = step === s;
            const isDone = ['discovery', 'configure', 'create'].indexOf(step) > i;
            return (
              <div key={s} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold',
                    isActive ? 'bg-emerald-600 text-white' : isDone ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-600'
                  )}
                >
                  {i + 1}
                </span>
                <span className={cn(isActive ? 'text-emerald-400' : 'text-gray-600', 'capitalize hidden sm:inline')}>
                  {s}
                </span>
                {i < 2 && <ChevronRight className="h-3 w-3 text-gray-700" />}
              </div>
            );
          })}
        </div>

        <Separator className="bg-gray-800" />

        {step === 'discovery' && (
          <div className="space-y-4">
            {discovering ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                <span className="ml-3 text-sm text-gray-400">Discovering collections...</span>
              </div>
            ) : discoverResult ? (
              <>
                {discoverResult.instanceInfo && (
                  <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2.5">
                    <Database className="h-4 w-4 text-orange-400" />
                    <div className="text-xs">
                      <span className="text-gray-300">Qdrant v{discoverResult.instanceInfo.version}</span>
                      <span className="ml-2 text-gray-600">({discoverResult.instanceInfo.mode})</span>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-400">Expected Collections</p>
                  {QDRANT_DEFAULT_COLLECTIONS.map((def) => {
                    const expected = discoverResult.expectedDefaults[def.key];
                    const found = expected?.found;
                    const existingCol = found
                      ? discoverResult.collections.find((c) => c.name === expected.name)
                      : null;

                    return (
                      <div
                        key={def.key}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                          found
                            ? 'border-emerald-500/20 bg-emerald-500/5'
                            : 'border-gray-800 bg-gray-800/40'
                        )}
                      >
                        {found ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0 text-gray-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={cn('text-sm font-medium', found ? 'text-emerald-400' : 'text-gray-300')}>
                            {def.defaultName}
                          </p>
                          <p className="text-[11px] text-gray-600">{def.description}</p>
                        </div>
                        {existingCol && (
                          <Badge variant="outline" className="border-gray-700 text-[9px] text-gray-500 font-mono">
                            {existingCol.vectorsCount} pts · {existingCol.vectorConfig.size}d
                          </Badge>
                        )}
                        {!found && (
                          <Badge className="border-gray-700 bg-gray-800 text-[9px] text-gray-500">
                            Missing
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>

                {allFound && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <p className="text-xs text-emerald-400">All expected collections are present</p>
                  </div>
                )}

                {discoverResult.collections.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-500 hover:text-gray-300">
                      All collections ({discoverResult.collections.length})
                    </summary>
                    <div className="mt-2 space-y-1">
                      {discoverResult.collections.map((col) => (
                        <div key={col.name} className="flex items-center gap-2 text-gray-600">
                          <span className="font-mono">{col.name}</span>
                          <span>{col.vectorsCount} pts · {col.vectorConfig.size}d {col.vectorConfig.distance}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-12 text-sm text-gray-500">
                Click &quot;Test&quot; on your Qdrant credential first, then open this wizard.
              </div>
            )}
          </div>
        )}

        {step === 'configure' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-gray-300">Embedding Provider</Label>
              <Select value={embeddingProvider} onValueChange={(v) => setEmbeddingProvider(v as EmbeddingProvider)}>
                <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-700 bg-gray-900">
                  {EMBEDDING_PROVIDER_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{p.label}</span>
                        <span className="text-[10px] text-gray-600">{p.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {embeddingProvider === 'custom' && (
              <div className="space-y-2">
                <Label className="text-gray-300">Vector Dimensions</Label>
                <Input
                  type="number"
                  value={customDims}
                  onChange={(e) => setCustomDims(parseInt(e.target.value) || 0)}
                  className="border-gray-700 bg-gray-800 text-white"
                  min={1}
                />
              </div>
            )}

            <Separator className="bg-gray-800" />

            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-400">
                Missing Collections ({missingConfigs.length})
              </p>
              {missingConfigs.map((config, idx) => (
                <div
                  key={config.key}
                  className="space-y-2 rounded-lg border border-gray-800 bg-gray-800/40 p-3"
                >
                  <p className="text-xs font-medium text-gray-300">{config.description}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">Collection Name</Label>
                      <Input
                        value={config.name}
                        onChange={(e) => {
                          const updated = [...missingConfigs];
                          updated[idx] = { ...config, name: e.target.value };
                          setMissingConfigs(updated);
                        }}
                        className="border-gray-700 bg-gray-800 text-white text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">Vector Dims</Label>
                      <Input
                        type="number"
                        value={config.vectorSize}
                        onChange={(e) => {
                          const updated = [...missingConfigs];
                          updated[idx] = { ...config, vectorSize: parseInt(e.target.value) || 0 };
                          setMissingConfigs(updated);
                        }}
                        className="border-gray-700 bg-gray-800 text-white text-xs font-mono"
                        min={1}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-500">Distance Metric</Label>
                    <Select
                      value={config.distance}
                      onValueChange={(v) => {
                        const updated = [...missingConfigs];
                        updated[idx] = { ...config, distance: v as QdrantDistanceMetric };
                        setMissingConfigs(updated);
                      }}
                    >
                      <SelectTrigger className="border-gray-700 bg-gray-800 text-white text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-gray-700 bg-gray-900">
                        <SelectItem value="Cosine">Cosine</SelectItem>
                        <SelectItem value="Euclid">Euclid</SelectItem>
                        <SelectItem value="Dot">Dot</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>

            {discoverResult && QDRANT_DEFAULT_COLLECTIONS.some(
              (def) => discoverResult.expectedDefaults[def.key]?.found
            ) && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-400">Already Exists (linked)</p>
                {QDRANT_DEFAULT_COLLECTIONS.filter(
                  (def) => discoverResult.expectedDefaults[def.key]?.found
                ).map((def) => {
                  const expected = discoverResult.expectedDefaults[def.key];
                  const col = discoverResult.collections.find((c) => c.name === expected?.name);
                  return (
                    <div key={def.key} className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                      <Link2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-xs font-mono text-emerald-400">{expected?.name}</span>
                      {col && (
                        <span className="text-[10px] text-gray-600">
                          {col.vectorsCount} pts · {col.vectorConfig.size}d
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === 'create' && (
          <div className="space-y-4">
            <p className="text-xs font-medium text-gray-400">Creating Collections</p>
            {missingConfigs.map((config) => (
              <div
                key={config.key}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                  config.created
                    ? 'border-emerald-500/20 bg-emerald-500/5'
                    : config.error
                    ? 'border-red-500/20 bg-red-500/5'
                    : 'border-gray-800 bg-gray-800/40'
                )}
              >
                {config.creating ? (
                  <Loader2 className="h-4 w-4 animate-spin text-orange-400" />
                ) : config.created ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : config.error ? (
                  <XCircle className="h-4 w-4 text-red-400" />
                ) : (
                  <Unlink className="h-4 w-4 text-gray-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-mono', config.created ? 'text-emerald-400' : config.error ? 'text-red-400' : 'text-gray-300')}>
                    {config.name}
                  </p>
                  {config.error && (
                    <p className="text-[10px] text-red-400/70">{config.error}</p>
                  )}
                </div>
                <Badge variant="outline" className="border-gray-700 text-[9px] text-gray-500 font-mono">
                  {config.vectorSize}d {config.distance}
                </Badge>
              </div>
            ))}

            {missingConfigs.every((c) => c.created) && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <p className="text-xs text-emerald-400">All collections created and linked successfully</p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {step !== 'discovery' ? (
            <Button
              variant="ghost"
              onClick={() => {
                if (step === 'configure') setStep('discovery');
                if (step === 'create') setStep('configure');
              }}
              disabled={creating}
              className="text-gray-400"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-gray-400">
              {step === 'create' && missingConfigs.every((c) => c.created) ? 'Done' : 'Cancel'}
            </Button>

            {step === 'discovery' && canGoNext && (
              <Button
                onClick={() => setStep('configure')}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}

            {step === 'configure' && canCreate && (
              <Button
                onClick={() => {
                  setStep('create');
                  handleCreate();
                }}
                disabled={creating}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create Collections
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}