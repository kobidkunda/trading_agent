'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Save,
  Upload,
  RotateCcw,
  GitCompare,
  Clock,
  FileCode,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import type { PromptState } from '@/lib/types';

// ── types ────────────────────────────────────────────────────────────────────

interface PromptVersion {
  version: number;
  body: string;
  state: PromptState;
  createdAt: string;
  author: string;
}

interface PromptTemplate {
  name: string;
  role: string;
  versions: PromptVersion[];
  currentVersion: number;
}

interface AuditEntry {
  id: string;
  promptName: string;
  action: 'created' | 'saved_draft' | 'published' | 'rolled_back';
  version: number;
  timestamp: string;
  author: string;
}

// ── mock data ────────────────────────────────────────────────────────────────

const PROMPT_NAMES = [
  'triage',
  'bull',
  'bear',
  'contradiction',
  'judge',
  'postmortem',
] as const;

const PROMPT_ROLES: Record<string, string> = {
  triage: 'Triage Agent',
  bull: 'Bull Advocate',
  bear: 'Bear Advocate',
  contradiction: 'Contradiction Agent',
  judge: 'Judge Arbitrator',
  postmortem: 'Postmortem Analyst',
};

const MOCK_PROMPTS: PromptTemplate[] = PROMPT_NAMES.map((name) => ({
  name,
  role: PROMPT_ROLES[name],
  versions: [
    {
      version: 1,
      body: DEFAULT_PROMPT_TEMPLATES[name],
      state: 'PUBLISHED',
      createdAt: '2025-01-10T08:00:00Z',
      author: 'system',
    },
    {
      version: 2,
      body:
        DEFAULT_PROMPT_TEMPLATES[name] +
        '\n\nAdditional instructions:\n- Always cite sources when making claims\n- Consider base rate probabilities\n- Note your confidence level (1-10)',
      state: 'DRAFT',
      createdAt: '2025-01-14T14:30:00Z',
      author: 'admin',
    },
  ],
  currentVersion: 1,
}));

const MOCK_AUDIT: AuditEntry[] = [
  {
    id: 'a1',
    promptName: 'judge',
    action: 'saved_draft',
    version: 2,
    timestamp: '2025-01-15T11:30:00Z',
    author: 'admin',
  },
  {
    id: 'a2',
    promptName: 'bull',
    action: 'saved_draft',
    version: 2,
    timestamp: '2025-01-14T14:30:00Z',
    author: 'admin',
  },
  {
    id: 'a3',
    promptName: 'triage',
    action: 'published',
    version: 1,
    timestamp: '2025-01-10T08:00:00Z',
    author: 'system',
  },
  {
    id: 'a4',
    promptName: 'bear',
    action: 'rolled_back',
    version: 1,
    timestamp: '2025-01-12T09:00:00Z',
    author: 'admin',
  },
  {
    id: 'a5',
    promptName: 'contradiction',
    action: 'created',
    version: 1,
    timestamp: '2025-01-10T08:00:00Z',
    author: 'system',
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────

function stateBadge(state: PromptState) {
  const styles: Record<PromptState, string> = {
    DRAFT: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    PUBLISHED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    ARCHIVED: 'border-gray-500/30 bg-gray-500/10 text-gray-500',
  };
  return (
    <Badge className={cn('text-[10px]', styles[state])}>{state}</Badge>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    created: 'Created',
    saved_draft: 'Saved Draft',
    published: 'Published',
    rolled_back: 'Rolled Back',
  };
  return labels[action] ?? action;
}

function actionColor(action: string): string {
  const colors: Record<string, string> = {
    created: 'text-emerald-400',
    saved_draft: 'text-amber-400',
    published: 'text-emerald-400',
    rolled_back: 'text-red-400',
  };
  return colors[action] ?? 'text-gray-400';
}

function simpleDiff(a: string, b: string): string {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const maxLen = Math.max(aLines.length, bLines.length);
  const result: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const al = aLines[i] ?? '';
    const bl = bLines[i] ?? '';
    if (al === bl) {
      result.push(`  ${al}`);
    } else {
      if (al) result.push(`- ${al}`);
      if (bl) result.push(`+ ${bl}`);
    }
  }
  return result.join('\n');
}

// ── component ────────────────────────────────────────────────────────────────

export function PromptStudio() {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePrompt, setActivePrompt] = useState<string>('triage');
  const [selectedVersion, setSelectedVersion] = useState<number>(1);
  const [editBody, setEditBody] = useState('');
  const [diffMode, setDiffMode] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load data
  useEffect(() => {
    let cancelled = false;
    async function fetchPrompts() {
      try {
        const res = await fetch('/api/prompts');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setPrompts(data.prompts ?? MOCK_PROMPTS);
          setAuditLog(data.audit ?? MOCK_AUDIT);
        }
      } catch {
        // fallback
      } finally {
        if (!cancelled) {
          setPrompts(MOCK_PROMPTS);
          setAuditLog(MOCK_AUDIT);
          setLoading(false);
        }
      }
    }
    fetchPrompts();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentPrompt = useMemo(
    () => prompts.find((p) => p.name === activePrompt),
    [prompts, activePrompt]
  );

  const currentVersionData = useMemo(() => {
    if (!currentPrompt) return null;
    return currentPrompt.versions.find((v) => v.version === selectedVersion);
  }, [currentPrompt, selectedVersion]);

  const publishedVersion = useMemo(() => {
    if (!currentPrompt) return null;
    return currentPrompt.versions.find(
      (v) => v.state === 'PUBLISHED'
    );
  }, [currentPrompt]);

  // Sync edit body when selection changes
  useEffect(() => {
    if (currentVersionData) {
      setEditBody(currentVersionData.body);
    }
  }, [currentVersionData]);

  const switchPrompt = useCallback((name: string) => {
    setActivePrompt(name);
    setSelectedVersion(1);
    setDiffMode(false);
  }, []);

  const saveDraft = useCallback(async () => {
    if (!currentPrompt || !currentVersionData) return;
    setSaving(true);
    try {
      await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: currentPrompt.name,
          version: selectedVersion,
          body: editBody,
          action: 'save_draft',
        }),
      });
    } catch {
      // ignore
    }
    // Update local state
    setPrompts((prev) =>
      prev.map((p) =>
        p.name === currentPrompt.name
          ? {
              ...p,
              versions: p.versions.map((v) =>
                v.version === selectedVersion
                  ? { ...v, body: editBody, state: 'DRAFT' as PromptState }
                  : v
              ),
            }
          : p
      )
    );
    setAuditLog((prev) => [
      {
        id: `local-${Date.now()}`,
        promptName: currentPrompt.name,
        action: 'saved_draft',
        version: selectedVersion,
        timestamp: new Date().toISOString(),
        author: 'admin',
      },
      ...prev,
    ]);
    setSaving(false);
    toast.success('Draft saved');
  }, [currentPrompt, selectedVersion, editBody]);

  const publish = useCallback(async () => {
    if (!currentPrompt || !currentVersionData) return;
    setSaving(true);
    try {
      await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: currentPrompt.name,
          version: selectedVersion,
          body: editBody,
          action: 'publish',
        }),
      });
    } catch {
      // ignore
    }
    setPrompts((prev) =>
      prev.map((p) =>
        p.name === currentPrompt.name
          ? {
              ...p,
              currentVersion: selectedVersion,
              versions: p.versions.map((v) => ({
                ...v,
                state: (v.version === selectedVersion
                  ? 'PUBLISHED'
                  : 'ARCHIVED') as PromptState,
              })),
            }
          : p
      )
    );
    setAuditLog((prev) => [
      {
        id: `local-${Date.now()}`,
        promptName: currentPrompt.name,
        action: 'published',
        version: selectedVersion,
        timestamp: new Date().toISOString(),
        author: 'admin',
      },
      ...prev,
    ]);
    setSaving(false);
    toast.success(`Version ${selectedVersion} published`);
  }, [currentPrompt, selectedVersion, editBody]);

  const rollback = useCallback(() => {
    if (!currentPrompt || !publishedVersion) return;
    setSelectedVersion(publishedVersion.version);
    setDiffMode(false);
    setAuditLog((prev) => [
      {
        id: `local-${Date.now()}`,
        promptName: currentPrompt.name,
        action: 'rolled_back',
        version: publishedVersion.version,
        timestamp: new Date().toISOString(),
        author: 'admin',
      },
      ...prev,
    ]);
    toast.info(`Rolled back to v${publishedVersion.version}`);
  }, [currentPrompt, publishedVersion]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Prompt Studio</h2>
        <div className="h-96 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Prompt Studio</h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage and version prompt templates for each agent role
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={diffMode ? 'default' : 'outline'}
            size="sm"
            className={cn(
              'gap-2',
              diffMode
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white'
            )}
            onClick={() => setDiffMode(!diffMode)}
          >
            <GitCompare className="h-4 w-4" />
            <span className="hidden sm:inline">Diff View</span>
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left sidebar - prompt list */}
        <div className="w-52 shrink-0 space-y-2">
          {prompts.map((p) => {
            const isActive = p.name === activePrompt;
            return (
              <button
                key={p.name}
                onClick={() => switchPrompt(p.name)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                  isActive
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-gray-800 bg-gray-900 hover:border-gray-700 hover:bg-gray-800/50'
                )}
              >
                <FileCode
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    isActive ? 'text-emerald-400' : 'text-gray-600'
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm font-medium capitalize',
                      isActive ? 'text-emerald-300' : 'text-gray-300'
                    )}
                  >
                    {p.name}
                  </p>
                  <p className="text-[11px] text-gray-600">{p.role}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {stateBadge(
                      p.versions.find((v) => v.version === p.currentVersion)
                        ?.state ?? 'DRAFT'
                    )}
                    <span className="text-[10px] text-gray-600">
                      v{p.currentVersion}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Main area */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Toolbar */}
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                <Select
                  value={String(selectedVersion)}
                  onValueChange={(v) => setSelectedVersion(Number(v))}
                >
                  <SelectTrigger className="w-28 border-gray-700 bg-gray-800 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-gray-700 bg-gray-900">
                    {currentPrompt?.versions.map((v) => (
                      <SelectItem
                        key={v.version}
                        value={String(v.version)}
                      >
                        Version {v.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentVersionData && stateBadge(currentVersionData.state)}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-gray-400 hover:bg-gray-800 hover:text-white"
                  onClick={saveDraft}
                  disabled={saving}
                >
                  <Save className="h-4 w-4" />
                  Save Draft
                </Button>
                <Button
                  size="sm"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={publish}
                  disabled={saving || currentVersionData?.state === 'PUBLISHED'}
                >
                  <Upload className="h-4 w-4" />
                  Publish
                </Button>
                {publishedVersion &&
                  publishedVersion.version !== selectedVersion && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-2 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                      onClick={rollback}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Rollback
                    </Button>
                  )}
              </div>
            </CardContent>
          </Card>

          {/* Editor / Diff view */}
          {diffMode && currentVersionData && publishedVersion ? (
            <Card className="border-gray-800 bg-gray-900">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-gray-400">
                  Diff: v{publishedVersion.version} → v{selectedVersion}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium text-emerald-400">
                      Published (v{publishedVersion.version})
                    </p>
                    <pre className="h-96 max-h-96 overflow-auto rounded-lg border border-gray-800 bg-gray-800/60 p-4 text-xs leading-relaxed text-gray-400">
                      {publishedVersion.body}
                    </pre>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-amber-400">
                      Current (v{selectedVersion})
                    </p>
                    <pre className="h-96 max-h-96 overflow-auto rounded-lg border border-gray-800 bg-gray-800/60 p-4 text-xs leading-relaxed text-gray-400">
                      {currentVersionData.body}
                    </pre>
                  </div>
                </div>
                {selectedVersion !== publishedVersion.version && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-gray-500">
                      Line-by-line diff
                    </p>
                    <pre className="max-h-64 overflow-auto rounded-lg border border-gray-800 bg-gray-800/60 p-4 font-mono text-xs leading-relaxed">
                      {simpleDiff(
                        publishedVersion.body,
                        currentVersionData.body
                      )
                        .split('\n')
                        .map((line, i) => (
                          <div
                            key={i}
                            className={cn(
                              line.startsWith('-')
                                ? 'bg-red-500/10 text-red-400'
                                : line.startsWith('+')
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : 'text-gray-600'
                            )}
                          >
                            {line || '\u00A0'}
                          </div>
                        ))}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-gray-800 bg-gray-900">
              <CardContent className="p-4">
                <Textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="min-h-[500px] resize-y border-gray-800 bg-gray-800 font-mono text-sm leading-relaxed text-gray-300 placeholder:text-gray-600"
                  placeholder="Select a prompt and version to edit..."
                />
              </CardContent>
            </Card>
          )}

          {/* Version metadata */}
          {currentVersionData && (
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Created: {formatTime(currentVersionData.createdAt)}
              </span>
              <span>Author: {currentVersionData.author}</span>
            </div>
          )}
        </div>
      </div>

      {/* Audit log */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white">Audit Log</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="max-h-64">
            <div className="space-y-2">
              {auditLog.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-gray-800/50 bg-gray-800/30 px-4 py-2.5"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'text-xs font-medium capitalize',
                        actionColor(entry.action)
                      )}
                    >
                      {actionLabel(entry.action)}
                    </span>
                    <span className="text-xs capitalize text-gray-400">
                      {entry.promptName}
                    </span>
                    <Badge
                      variant="outline"
                      className="border-gray-700 text-[10px] text-gray-500"
                    >
                      v{entry.version}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-gray-600">
                    <span>{entry.author}</span>
                    <span>{formatTime(entry.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
