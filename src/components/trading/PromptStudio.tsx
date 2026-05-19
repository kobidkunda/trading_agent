'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Save,
  Upload,
  RotateCcw,
  GitCompare,
  Clock,
  FileCode,
  Plus,
  Loader2,
  Sparkles,
  Search,
  XCircle,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import type { PromptState } from '@/lib/types';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

// ── types ────────────────────────────────────────────────────────────────────

interface RawPromptItem {
  id: string;
  name: string;
  version: number;
  state: PromptState;
  body: string;
  description?: string;
  changelog?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface PromptVersion {
  id?: string;
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

// ── constants (NOT mock data) ────────────────────────────────────────────────

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

/** Build grouped PromptTemplate[] from flat API response */
function buildPromptTemplates(
  flat: RawPromptItem[],
): PromptTemplate[] {
  const grouped = new Map<string, PromptTemplate>();

  for (const item of flat) {
    if (!grouped.has(item.name)) {
      grouped.set(item.name, {
        name: item.name,
        role: PROMPT_ROLES[item.name] ?? item.name,
        versions: [],
        currentVersion: item.state === 'PUBLISHED' ? item.version : 0,
      });
    }
    const tmpl = grouped.get(item.name)!;
    tmpl.versions.push({
      id: item.id,
      version: item.version,
      body: item.body,
      state: item.state,
      createdAt: item.createdAt,
      author: 'admin',
    });
    if (item.state === 'PUBLISHED') {
      tmpl.currentVersion = item.version;
    }
  }

  // If no published version found, use the highest version
  for (const tmpl of grouped.values()) {
    if (tmpl.currentVersion === 0 && tmpl.versions.length > 0) {
      const max = Math.max(...tmpl.versions.map((v) => v.version));
      tmpl.currentVersion = max;
    }
    // Sort versions ascending
    tmpl.versions.sort((a, b) => a.version - b.version);
  }

  // Return in standard order
  return PROMPT_NAMES.map((name) => grouped.get(name)!).filter(Boolean);
}

// ── component ────────────────────────────────────────────────────────────────

export function PromptStudio() {
  // ── search + filter + sort ──
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('ALL');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // ── editor state ──
  const [activePrompt, setActivePrompt] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<number>(1);
  const [editBody, setEditBody] = useState('');
  const [diffMode, setDiffMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data: flatPrompts,
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
  } = usePagination<RawPromptItem>(
    async (params: PaginationParams): Promise<PaginatedResponse<RawPromptItem>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: (params.sortBy as string) || 'name',
        sortOrder: params.sortOrder || 'asc',
      });
      if (debouncedSearch.trim()) query.set('search', debouncedSearch.trim());
      if (stateFilter !== 'ALL') query.set('state', stateFilter);

      const res = await fetch(`/api/prompts?${query}`);
      if (!res.ok) throw new Error('Failed to fetch prompts');
      return res.json();
    },
    [debouncedSearch, stateFilter],
    { defaultSortBy: 'name', defaultSortOrder: 'asc' },
  );

  // Group flat API data into PromptTemplate[]
  const prompts = useMemo(() => buildPromptTemplates(flatPrompts), [flatPrompts]);

  // Build audit log from flat data
  const auditLog = useMemo(() => {
    return flatPrompts.map((p) => ({
      id: `${p.name}-${p.version}`,
      promptName: p.name,
      action: (p.state === 'PUBLISHED' ? 'published' : 'created') as AuditEntry['action'],
      version: p.version,
      timestamp: p.createdAt,
      author: 'admin',
    }));
  }, [flatPrompts]);

  // Set active prompt to first available after load
  useEffect(() => {
    if (prompts.length > 0 && !activePrompt) {
      setActivePrompt(prompts[0].name);
    }
  }, [prompts, activePrompt]);

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
      const updateRes = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentVersionData.id,
          name: currentPrompt.name,
          version: selectedVersion,
          body: editBody,
          state: 'DRAFT',
        }),
      });
      if (!updateRes.ok) {
        await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: currentPrompt.name,
            body: editBody,
            state: 'DRAFT',
          }),
        });
      }
      toast.success('Draft saved');
      fetchData();
    } catch {
      // ignore
    }
    setSaving(false);
  }, [currentPrompt, selectedVersion, editBody, fetchData]);

  const publish = useCallback(async () => {
    if (!currentPrompt || !currentVersionData) return;
    setSaving(true);
    try {
      const updateRes = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentVersionData.id,
          name: currentPrompt.name,
          version: selectedVersion,
          body: editBody,
          state: 'PUBLISHED',
        }),
      });
      if (!updateRes.ok) {
        await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: currentPrompt.name,
            body: editBody,
            state: 'PUBLISHED',
          }),
        });
      }
      toast.success(`Version ${selectedVersion} published`);
      fetchData();
    } catch {
      // ignore
    }
    setSaving(false);
  }, [currentPrompt, selectedVersion, editBody, fetchData]);

  const rollback = useCallback(() => {
    if (!currentPrompt || !publishedVersion) return;
    setSelectedVersion(publishedVersion.version);
    setDiffMode(false);
    toast.info(`Rolled back to v${publishedVersion.version}`);
  }, [currentPrompt, publishedVersion]);

  const seedDefaults = useCallback(async () => {
    setSeeding(true);
    try {
      const existingRes = await fetch('/api/prompts?limit=50');
      const existingData = existingRes.ok ? await existingRes.json() : { data: [] };
      const existingNames = new Set((existingData.data ?? []).map((p: RawPromptItem) => p.name));

      for (const name of PROMPT_NAMES) {
        if (existingNames.has(name)) continue;
        await fetch('/api/prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            body: DEFAULT_PROMPT_TEMPLATES[name],
            state: 'PUBLISHED',
          }),
        });
      }
      toast.success('Default prompts seeded');
      fetchData();
    } catch {
      toast.error('Failed to seed default prompts');
    } finally {
      setSeeding(false);
    }
  }, [fetchData]);

  if (loading && flatPrompts.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Prompt Studio</h2>
        <div className="h-96 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  if (error && flatPrompts.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Prompt Studio</h2>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Prompt Studio</h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage and version prompt templates for each agent role
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <Input
              placeholder="Search prompts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48 border-gray-700 bg-gray-800 pl-8 text-xs text-white placeholder:text-gray-600"
            />
          </div>
          {/* State filter */}
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="h-8 w-28 border-gray-700 bg-gray-800 text-xs text-gray-300">
              <SelectValue placeholder="All States" />
            </SelectTrigger>
            <SelectContent className="border-gray-700 bg-gray-900">
              <SelectItem value="ALL" className="text-xs">All States</SelectItem>
              <SelectItem value="DRAFT" className="text-xs">Draft</SelectItem>
              <SelectItem value="PUBLISHED" className="text-xs">Published</SelectItem>
              <SelectItem value="ARCHIVED" className="text-xs">Archived</SelectItem>
            </SelectContent>
          </Select>
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

      {/* Empty state when no prompts */}
      {prompts.length === 0 ? (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <FileCode className="h-7 w-7 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-400">
              No prompt templates
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Initialize prompts to get started.
            </p>
            <Button
              size="sm"
              className="mt-4 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={seedDefaults}
              disabled={seeding}
            >
              {seeding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Seed Default Prompts
            </Button>
          </CardContent>
        </Card>
      ) : (
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
      )}

      {/* Audit log */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            Audit Log
            <span className="ml-1 text-xs font-normal text-gray-500">
              ({(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {auditLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <p className="text-xs text-gray-600">No audit entries</p>
            </div>
          ) : (
            <>
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
              <div className="flex items-center justify-between border-t border-gray-800 pt-3 mt-3">
                <span className="text-xs text-gray-500">
                  Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total} entries
                </span>
                {loading && (
                  <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                )}
                <PaginationBar page={page} totalPages={totalPages} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
