'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  KeyRound,
  CheckCircle2,
  XCircle,
  HelpCircle,
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ── types ────────────────────────────────────────────────────────────────────

type ConnStatus = 'SUCCESS' | 'FAILED' | 'UNTESTED';

interface Credential {
  id: string;
  service: string;
  label: string;
  maskedPreview: string | null;
  isActive: boolean;
  lastTestedAt: string | null;
  testResult: string | null;
}

// ── constants ────────────────────────────────────────────────────────────────

const SERVICE_OPTIONS = [
  'Polymarket',
  'Kalshi',
  'Gemini',
  'OpenAI',
  'Qdrant',
  'Mem0',
  'Ollama',
  'SearXNG',
] as const;

const SERVICE_COLORS: Record<string, string> = {
  Polymarket: 'text-blue-400',
  Kalshi: 'text-purple-400',
  Gemini: 'text-cyan-400',
  OpenAI: 'text-emerald-400',
  Qdrant: 'text-orange-400',
  Mem0: 'text-pink-400',
  Ollama: 'text-amber-400',
  SearXNG: 'text-teal-400',
};

// ── helpers ──────────────────────────────────────────────────────────────────

function maskValue(val: string): string {
  if (val.length <= 8) return '****';
  return val.slice(0, 4) + '****' + val.slice(-4);
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

// ── component ────────────────────────────────────────────────────────────────

export function CredentialManager() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Credential | null>(null);

  // Form state for add dialog
  const [newService, setNewService] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function fetchCreds() {
      try {
        const res = await fetch('/api/credentials');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setCredentials(data.credentials ?? []);
        }
      } catch {
        toast.error('Failed to load credentials');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchCreds();
    return () => {
      cancelled = true;
    };
  }, []);

  const testConnection = useCallback(async (cred: Credential) => {
    setTestingId(cred.id);
    try {
      const res = await fetch(`/api/credentials/test?id=${cred.id}`, {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setCredentials((prev) =>
          prev.map((c) =>
            c.id === cred.id
              ? { ...c, testResult: data.testResult ?? data.status, lastTestedAt: new Date().toISOString() }
              : c
          )
        );
        toast.success(`${cred.service}: ${data.testResult ?? data.status}`);
      } else {
        toast.error(`Failed to test ${cred.service} connection`);
      }
    } catch {
      toast.error('Network error during test');
    } finally {
      setTestingId(null);
    }
  }, []);

  const addCredential = useCallback(async () => {
    if (!newService || !newLabel || !newValue) {
      toast.error('All fields are required');
      return;
    }
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: newService,
          label: newLabel,
          encryptedData: JSON.stringify({ apiKey: newValue }),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCredentials((prev) => [...prev, {
          id: data.id,
          service: data.service,
          label: data.label,
          maskedPreview: data.maskedPreview,
          isActive: data.isActive ?? true,
          lastTestedAt: data.lastTestedAt,
          testResult: data.testResult,
        }]);
        toast.success('Credential added');
      } else {
        toast.error('Failed to add credential');
      }
    } catch {
      toast.error('Network error — could not add credential');
    }
    setAddOpen(false);
    setNewService('');
    setNewLabel('');
    setNewValue('');
  }, [newService, newLabel, newValue]);

  const deleteCredential = useCallback(async (cred: Credential) => {
    try {
      await fetch(`/api/credentials?id=${cred.id}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
    setCredentials((prev) => prev.filter((c) => c.id !== cred.id));
    setDeleteTarget(null);
    toast.success(`${cred.service} credential removed`);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Credentials</h2>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl bg-gray-900"
          />
        ))}
      </div>
    );
  }

  const successCount = credentials.filter(
    (c) => c.testResult === 'SUCCESS'
  ).length;
  const failedCount = credentials.filter(
    (c) => c.testResult === 'FAILED'
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">
            Credential Manager
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage API keys and service connections
          </p>
        </div>
        <div className="flex items-center gap-3">
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
            <DialogContent className="border-gray-800 bg-gray-900 text-white">
              <DialogHeader>
                <DialogTitle>Add New Credential</DialogTitle>
                <DialogDescription className="text-gray-500">
                  Enter the service details and credential value
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label className="text-gray-300">Service</Label>
                  <Select value={newService} onValueChange={setNewService}>
                    <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                      <SelectValue placeholder="Select service" />
                    </SelectTrigger>
                    <SelectContent className="border-gray-700 bg-gray-900">
                      {SERVICE_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">Label</Label>
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. Production API Key"
                    className="border-gray-700 bg-gray-800 text-white placeholder:text-gray-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-gray-300">Credential Value</Label>
                  <Input
                    type="password"
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="Enter API key, URL, or token"
                    className="border-gray-700 bg-gray-800 text-white placeholder:text-gray-600"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setAddOpen(false)}
                  className="text-gray-400"
                >
                  Cancel
                </Button>
                <Button
                  onClick={addCredential}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Empty state */}
      {credentials.length === 0 ? (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <KeyRound className="h-7 w-7 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-400">
              No credentials configured
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Add API keys and service connections to get started
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
              <DialogContent className="border-gray-800 bg-gray-900 text-white">
                <DialogHeader>
                  <DialogTitle>Add New Credential</DialogTitle>
                  <DialogDescription className="text-gray-500">
                    Enter the service details and credential value
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label className="text-gray-300">Service</Label>
                    <Select value={newService} onValueChange={setNewService}>
                      <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                        <SelectValue placeholder="Select service" />
                      </SelectTrigger>
                      <SelectContent className="border-gray-700 bg-gray-900">
                        {SERVICE_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Label</Label>
                    <Input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="e.g. Production API Key"
                      className="border-gray-700 bg-gray-800 text-white placeholder:text-gray-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-gray-300">Credential Value</Label>
                    <Input
                      type="password"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      placeholder="Enter API key, URL, or token"
                      className="border-gray-700 bg-gray-800 text-white placeholder:text-gray-600"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setAddOpen(false)}
                    className="text-gray-400"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={addCredential}
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    Add
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      ) : (
        /* Credential cards grid */
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {credentials.map((cred) => (
            <Card
              key={cred.id}
              className="group border-gray-800 bg-gray-900 transition-colors hover:border-gray-700"
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-800">
                      <KeyRound
                        className={cn(
                          'h-4 w-4',
                          SERVICE_COLORS[cred.service] ?? 'text-gray-400'
                        )}
                      />
                    </div>
                    <div>
                      <CardTitle className="text-sm font-semibold text-white">
                        {cred.service}
                      </CardTitle>
                      <CardDescription className="text-xs text-gray-500">
                        {cred.label}
                      </CardDescription>
                    </div>
                  </div>
                  <StatusBadge testResult={cred.testResult} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-gray-800 bg-gray-800/60 px-3 py-2">
                  <code className="text-xs font-mono text-gray-400">
                    {cred.maskedPreview || '****'}
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-600">
                    Last tested: {formatTime(cred.lastTestedAt)}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-xs text-gray-400 hover:text-white"
                      onClick={() => testConnection(cred)}
                      disabled={testingId === cred.id}
                    >
                      {testingId === cred.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Test
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
                      onClick={() => setDeleteTarget(cred)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
              <span className="font-medium text-gray-300">
                {deleteTarget?.service}
              </span>{' '}
              credential &ldquo;
              <span className="font-medium text-gray-300">
                {deleteTarget?.label}
              </span>
              &rdquo;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-gray-400">
              Cancel
            </AlertDialogCancel>
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
