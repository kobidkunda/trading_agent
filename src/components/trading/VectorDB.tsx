'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Database,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Unlink,
  Link2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { QDRANT_DEFAULT_COLLECTIONS, EMBEDDING_PROVIDER_OPTIONS } from '@/lib/constants';
import type { QdrantCollectionInfo, QdrantDistanceMetric, EmbeddingProvider } from '@/lib/types';

interface QdrantCredential {
  id: string;
  service: string;
  label: string;
  serviceUrl: string | null;
  testResult: string | null;
  testDetails: string | null;
}

export function VectorDB() {
  const [credentials, setCredentials] = useState<QdrantCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCredId, setSelectedCredId] = useState<string | null>(null);
  const [collections, setCollections] = useState<QdrantCollectionInfo[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [expandedCol, setExpandedCol] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [collectionLinks, setCollectionLinks] = useState<Record<string, string>>({});

  const [newName, setNewName] = useState('');
  const [newDims, setNewDims] = useState(1536);
  const [newDistance, setNewDistance] = useState<QdrantDistanceMetric>('Cosine');
  const [newProvider, setNewProvider] = useState<EmbeddingProvider>('openai');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function fetchCreds() {
      try {
        const res = await fetch('/api/credentials');
        if (res.ok) {
          const data = await res.json();
          const qdrantCreds = (data.credentials || []).filter(
            (c: QdrantCredential) => c.service.toLowerCase() === 'qdrant'
          );
          setCredentials(qdrantCreds);
          if (qdrantCreds.length > 0 && !selectedCredId) {
            setSelectedCredId(qdrantCreds[0].id);
          }
        }
      } catch {
        toast.error('Failed to load credentials');
      } finally {
        setLoading(false);
      }
    }
    fetchCreds();
  }, []);

  const fetchCollections = useCallback(async (credId: string) => {
    setLoadingCollections(true);
    try {
      const res = await fetch(`/api/qdrant/collections?credentialId=${credId}`);
      if (res.ok) {
        const data = await res.json();
        const rawCols = data.collections || [];
        const details: QdrantCollectionInfo[] = [];

        for (const col of rawCols) {
          try {
            const infoRes = await fetch(`/api/qdrant/collections/${col.name}?credentialId=${credId}`);
            if (infoRes.ok) {
              const infoData = await infoRes.json();
              const vectorConfig = infoData.config?.params?.vectors;
              let size = 0;
              let distance: string = 'Cosine';
              if (vectorConfig) {
                if (Array.isArray(vectorConfig)) {
                  size = vectorConfig[0]?.size || 0;
                  distance = vectorConfig[0]?.distance || 'Cosine';
                } else if (typeof vectorConfig === 'object') {
                  const firstKey = Object.keys(vectorConfig)[0];
                  if (firstKey && vectorConfig[firstKey]) {
                    size = vectorConfig[firstKey].size || 0;
                    distance = vectorConfig[firstKey].distance || 'Cosine';
                  } else {
                    size = vectorConfig.size || 0;
                    distance = vectorConfig.distance || 'Cosine';
                  }
                }
              }
              details.push({
                name: col.name,
                vectorsCount: infoData.points_count || infoData.vectors_count || 0,
                status: infoData.status || 'unknown',
                vectorConfig: {
                  size,
                  distance: distance as QdrantDistanceMetric,
                },
              });
            }
          } catch {}
        }

        setCollections(details);
      }
    } catch {
      toast.error('Failed to fetch collections');
    } finally {
      setLoadingCollections(false);
    }
  }, []);

  const fetchLinks = useCallback(async (credId: string) => {
    try {
      const res = await fetch(`/api/settings?key=qdrant_collections_${credId}`);
      if (res.ok) {
        const data = await res.json();
        setCollectionLinks(data.value ? JSON.parse(data.value) : {});
      } else {
        setCollectionLinks({});
      }
    } catch {
      setCollectionLinks({});
    }
  }, []);

  useEffect(() => {
    if (selectedCredId) {
      fetchCollections(selectedCredId);
      fetchLinks(selectedCredId);
    }
  }, [selectedCredId, fetchCollections, fetchLinks]);

  const handleCreate = useCallback(async () => {
    if (!selectedCredId || !newName.trim() || newDims <= 0) return;
    setCreating(true);
    try {
      const res = await fetch('/api/qdrant/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentialId: selectedCredId,
          name: newName.trim(),
          vectorSize: newDims,
          distance: newDistance,
        }),
      });
      if (res.ok) {
        toast.success(`Collection "${newName}" created`);
        setCreateOpen(false);
        setNewName('');
        fetchCollections(selectedCredId);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to create collection');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setCreating(false);
    }
  }, [selectedCredId, newName, newDims, newDistance, fetchCollections]);

  const handleDelete = useCallback(async (name: string) => {
    if (!selectedCredId) return;
    try {
      const res = await fetch(`/api/qdrant/collections/${name}?credentialId=${selectedCredId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(`Collection "${name}" deleted`);
        fetchCollections(selectedCredId);
      } else {
        toast.error('Failed to delete collection');
      }
    } catch {
      toast.error('Network error');
    }
    setDeleteTarget(null);
  }, [selectedCredId, fetchCollections]);

  const activeCredential = credentials.find((c) => c.id === selectedCredId);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Vector DB</h2>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-900" />
        ))}
      </div>
    );
  }

  if (credentials.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Vector DB</h2>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <Database className="h-7 w-7 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-400">No Qdrant instance connected</p>
            <p className="mt-1 max-w-md text-center text-xs text-gray-600">
              Add a Qdrant credential in the Credentials page to manage vector collections here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Vector DB</h2>
          <p className="mt-1 text-sm text-gray-500">Manage Qdrant vector collections</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedCredId || ''} onValueChange={setSelectedCredId}>
            <SelectTrigger className="w-48 border-gray-700 bg-gray-800 text-white text-xs">
              <SelectValue placeholder="Select instance..." />
            </SelectTrigger>
            <SelectContent className="border-gray-700 bg-gray-900">
              {credentials.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', c.testResult === 'SUCCESS' ? 'bg-emerald-400' : 'bg-gray-500')} />
                    <span className="text-xs">{c.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => {
              setNewName('');
              setNewProvider('openai');
              setNewDims(1536);
              setNewDistance('Cosine');
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Collection
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-400"
            onClick={() => selectedCredId && fetchCollections(selectedCredId)}
            disabled={loadingCollections}
          >
            {loadingCollections ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {activeCredential && (
        <Card className={cn(
          'border-gray-800 bg-gray-900',
          activeCredential.testResult === 'SUCCESS' && 'border-emerald-500/20'
        )}>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
              <Database className="h-5 w-5 text-orange-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-orange-400">Qdrant</p>
                <Badge className={cn(
                  'gap-1 text-[10px]',
                  activeCredential.testResult === 'SUCCESS'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-gray-500/30 bg-gray-500/10 text-gray-400'
                )}>
                  {activeCredential.testResult === 'SUCCESS' ? (
                    <><CheckCircle2 className="h-3 w-3" /> Connected</>
                  ) : (
                    <><XCircle className="h-3 w-3" /> Disconnected</>
                  )}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {activeCredential.label} · <code className="text-gray-600">{activeCredential.serviceUrl}</code>
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {QDRANT_DEFAULT_COLLECTIONS.map((def) => {
                const isLinked = !!collectionLinks[def.key];
                return (
                  <button
                    key={def.key}
                    title={`${def.defaultName}: ${isLinked ? 'Linked' : 'Not linked'}`}
                    className={cn(
                      'h-3 w-3 rounded-full transition-colors',
                      isLinked ? 'bg-emerald-400' : 'bg-gray-700'
                    )}
                  />
                );
              })}
              <span className="ml-1 text-[10px] text-gray-600">
                {Object.keys(collectionLinks).length}/{QDRANT_DEFAULT_COLLECTIONS.length}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {loadingCollections ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
          <span className="ml-3 text-sm text-gray-400">Loading collections...</span>
        </div>
      ) : collections.length === 0 ? (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Unlink className="mb-3 h-8 w-8 text-gray-600" />
            <p className="text-sm text-gray-400">No collections found</p>
            <p className="mt-1 text-xs text-gray-600">
              Create your first collection or use the Setup Wizard from the Credentials page.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {collections.map((col) => {
            const isExpanded = expandedCol === col.name;
            const isLinked = Object.values(collectionLinks).includes(col.name);

            return (
              <Card
                key={col.name}
                className={cn(
                  'border-gray-800 bg-gray-900 transition-all',
                  isLinked && 'border-emerald-500/20'
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <button
                    onClick={() => setExpandedCol(isExpanded ? null : col.name)}
                    className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', isLinked ? 'bg-emerald-500/10' : 'bg-gray-800')}>
                    <Database className={cn('h-4 w-4', isLinked ? 'text-emerald-400' : 'text-gray-400')} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm font-mono font-semibold', isLinked ? 'text-emerald-400' : 'text-gray-200')}>
                        {col.name}
                      </p>
                      {isLinked && (
                        <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-[9px] text-emerald-400">
                          <Link2 className="h-2.5 w-2.5" />
                          Linked
                        </Badge>
                      )}
                      <Badge variant="outline" className={cn(
                        'text-[9px]',
                        col.status === 'green' ? 'border-emerald-500/30 text-emerald-400' : 'border-gray-700 text-gray-500'
                      )}>
                        {col.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-600">
                      {col.vectorsCount.toLocaleString()} points · {col.vectorConfig.size}d {col.vectorConfig.distance}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => setDeleteTarget(col.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-800/50 px-4 py-3 sm:px-5">
                    <div className="grid grid-cols-3 gap-3 text-[11px]">
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-2.5">
                        <p className="text-gray-500">Points</p>
                        <p className="mt-1 font-mono text-gray-300">{col.vectorsCount.toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-2.5">
                        <p className="text-gray-500">Dimensions</p>
                        <p className="mt-1 font-mono text-gray-300">{col.vectorConfig.size}</p>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-2.5">
                        <p className="text-gray-500">Distance</p>
                        <p className="mt-1 font-mono text-gray-300">{col.vectorConfig.distance}</p>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-gray-800 bg-gray-900 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Create Collection</DialogTitle>
            <DialogDescription className="text-gray-500">Add a new Qdrant vector collection</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-gray-300">Collection Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. my_collection"
                className="border-gray-700 bg-gray-800 text-white font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">Embedding Provider</Label>
              <Select value={newProvider} onValueChange={(v) => {
                setNewProvider(v as EmbeddingProvider);
                const p = EMBEDDING_PROVIDER_OPTIONS.find((o) => o.value === v);
                if (p && p.value !== 'custom') setNewDims(p.defaultDims);
              }}>
                <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-700 bg-gray-900">
                  {EMBEDDING_PROVIDER_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span className="text-xs">{p.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">Vector Dimensions</Label>
              <Input
                type="number"
                value={newDims}
                onChange={(e) => setNewDims(parseInt(e.target.value) || 0)}
                className="border-gray-700 bg-gray-800 text-white font-mono text-sm"
                min={1}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">Distance Metric</Label>
              <Select value={newDistance} onValueChange={(v) => setNewDistance(v as QdrantDistanceMetric)}>
                <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
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

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="text-gray-400">Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || newDims <= 0 || creating}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="border-gray-800 bg-gray-900 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Collection</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500">
              Delete collection &ldquo;<span className="font-mono text-gray-300">{deleteTarget}</span>&rdquo;?
              This will permanently remove all vectors. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-gray-400">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}