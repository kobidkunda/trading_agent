import type {
  MetadataOption,
  TransparencySourceRef,
  TransparencyStageRecord,
} from '@/lib/types';

function getDomain(url: string | null | undefined): string | null {
  if (!url) return null;

  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

type SourceLike = {
  title?: string | null;
  url?: string | null;
  snippet?: string | null;
  provider?: string | null;
  reasonIncluded?: string | null;
};

export function withStaleOption(options: MetadataOption[], savedValue?: string | null): MetadataOption[] {
  if (!savedValue) {
    return options;
  }

  if (options.some((option) => option.id === savedValue)) {
    return options;
  }

  return [{ id: savedValue, label: savedValue, stale: true }, ...options];
}

export function normalizeSourceRef(source: SourceLike): TransparencySourceRef {
  return {
    title: source.title || source.url || 'Untitled source',
    url: source.url || '',
    domain: getDomain(source.url),
    snippet: source.snippet || null,
    provider: source.provider || null,
    reasonIncluded: source.reasonIncluded || null,
  };
}

export function buildStageTransparencyRecord(input: {
  stage: string;
  serviceName: string;
  provider?: string | null;
  model?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  status: TransparencyStageRecord['status'];
  failureReason?: string | null;
  summary?: string | null;
  rawOutput?: string | null;
  sources?: SourceLike[];
  references?: SourceLike[];
}): TransparencyStageRecord {
  const started = input.startedAt ? Date.parse(input.startedAt) : Number.NaN;
  const ended = input.endedAt ? Date.parse(input.endedAt) : Number.NaN;

  return {
    stage: input.stage,
    serviceName: input.serviceName,
    provider: input.provider || null,
    model: input.model || null,
    startedAt: input.startedAt || null,
    endedAt: input.endedAt || null,
    durationMs: Number.isFinite(started) && Number.isFinite(ended) ? ended - started : null,
    status: input.status,
    failureReason: input.failureReason || null,
    summary: input.summary || null,
    rawOutput: input.rawOutput || null,
    sources: (input.sources || []).map(normalizeSourceRef),
    references: (input.references || []).map(normalizeSourceRef),
  };
}
