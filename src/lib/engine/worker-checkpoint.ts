import { db } from '@/lib/db';

// ── Types ──────────────────────────────────────────────────────────────

export interface CheckpointProgress {
  /** Current pipeline stage (e.g. 'TRIAGED', 'RESEARCHING', 'JUDGED') */
  stage?: string;
  /** Progress 0-100 within the current stage */
  progress?: number;
  /** Arbitrary intermediate state for recovery */
  state?: Record<string, unknown>;
}

export interface DeepResearchProgress {
  /** Queries that have already been executed */
  completedSearchQueries?: string[];
  /** Count of content extracted so far */
  extractedContentCount?: number;
  /** Which phase of deep research we're in */
  currentSearchPhase?: 'WEB_SEARCH' | 'DEERFLOW' | 'TRADINGAGENTS' | 'AGENT_REACH' | 'SYNTHESIS';
  /** IDs of partial results (agent output IDs or source IDs) */
  partialResultIds?: string[];
  /** Any error context from prior attempt */
  lastError?: string;
}

export interface StageTransition {
  from: string;
  to: string;
  timestamp: string;
  reason?: string;
  jobId?: string;
}

// ── Constants ───────────────────────────────────────────────────────────

const STALE_CHECKPOINT_MS = 600_000; // 10 min default
const DEEP_RESEARCH_STALE_MS = 30 * 60_000; // 30 min for deep research (longer phases)

// ── Core checkpoint functions ───────────────────────────────────────────

/**
 * Upsert a ResearchCheckpoint for the given job.
 * Serialises `state` as JSON into the `state` column.
 * Heartbeat timestamp always updated to now.
 *
 * Also accepts optional stage/progress metadata, which are merged into the stored state.
 */
export async function saveCheckpoint(
  jobId: string,
  state: Record<string, unknown>,
  progress?: CheckpointProgress,
): Promise<void> {
  try {
    const mergedState: Record<string, unknown> = {
      ...state,
      ...(progress?.stage ? { _stage: progress.stage } : {}),
      ...(progress?.progress != null ? { _progress: progress.progress } : {}),
      ...(progress?.state ? { _intermediateState: progress.state } : {}),
    };

    await db.researchCheckpoint.upsert({
      where: { jobId },
      update: {
        state: JSON.stringify(mergedState),
        lastHeartbeatAt: new Date(),
      },
      create: {
        jobId,
        state: JSON.stringify(mergedState),
        lastHeartbeatAt: new Date(),
      },
    });
  } catch {
    // Silently skip – checkpoint is best-effort
  }
}

/**
 * Load the checkpoint state for a job, or null if none exists.
 * If the checkpoint is stale (lastHeartbeatAt older than maxAgeMs), returns null.
 */
export async function loadCheckpoint(
  jobId: string,
  maxAgeMs: number = STALE_CHECKPOINT_MS,
): Promise<Record<string, unknown> | null> {
  try {
    const checkpoint = await db.researchCheckpoint.findUnique({
      where: { jobId },
    });

    if (!checkpoint) return null;

    const age = Date.now() - new Date(checkpoint.lastHeartbeatAt).getTime();
    if (age > maxAgeMs) return null; // stale – don't trust it

    return JSON.parse(checkpoint.state);
  } catch {
    return null;
  }
}

/**
 * Load checkpoint and extract inner intermediate state (the `_intermediateState` field).
 * For deep research resume scenarios.
 */
export async function loadIntermediateState(
  jobId: string,
  maxAgeMs: number = DEEP_RESEARCH_STALE_MS,
): Promise<Record<string, unknown> | null> {
  const checkpoint = await loadCheckpoint(jobId, maxAgeMs);
  if (!checkpoint) return null;

  const intermediate = checkpoint._intermediateState;
  if (typeof intermediate === 'object' && intermediate !== null) {
    return intermediate as Record<string, unknown>;
  }
  return null;
}

// ── Deep research checkpointing ─────────────────────────────────────────

/**
 * Save deep-research-specific progress for resume-on-retry.
 * Merges into the intermediate state under `_intermediateState._deepResearch`.
 */
export async function saveDeepResearchProgress(
  jobId: string,
  researchRunId: string,
  progress: DeepResearchProgress,
): Promise<void> {
  await saveCheckpoint(
    jobId,
    { researchRunId },
    {
      stage: 'RESEARCHING',
      progress: progress.currentSearchPhase === 'SYNTHESIS' ? 90 : estimateResearchProgress(progress),
      state: {
        _deepResearch: progress,
        _researchRunId: researchRunId,
      },
    },
  );
}

/**
 * Load deep research progress for resume. Returns null if nothing saved or stale.
 */
export async function loadDeepResearchProgress(
  jobId: string,
): Promise<(DeepResearchProgress & { researchRunId?: string }) | null> {
  const intermediate = await loadIntermediateState(jobId, DEEP_RESEARCH_STALE_MS);
  if (!intermediate?._deepResearch) return null;

  const drp = intermediate._deepResearch as Record<string, unknown>;
  return {
    completedSearchQueries: Array.isArray(drp.completedSearchQueries) ? drp.completedSearchQueries as string[] : undefined,
    extractedContentCount: typeof drp.extractedContentCount === 'number' ? drp.extractedContentCount as number : undefined,
    currentSearchPhase: typeof drp.currentSearchPhase === 'string' ? drp.currentSearchPhase as DeepResearchProgress['currentSearchPhase'] : undefined,
    partialResultIds: Array.isArray(drp.partialResultIds) ? drp.partialResultIds as string[] : undefined,
    lastError: typeof drp.lastError === 'string' ? drp.lastError as string : undefined,
    researchRunId: typeof intermediate._researchRunId === 'string' ? intermediate._researchRunId as string : undefined,
  };
}

/**
 * Safely increment the extracted content counter in the checkpoint.
 */
export async function incrementExtractedContentCount(
  jobId: string,
  researchRunId: string,
  increment: number,
  currentPhase: DeepResearchProgress['currentSearchPhase'],
): Promise<void> {
  const existing = await loadDeepResearchProgress(jobId);
  await saveDeepResearchProgress(jobId, researchRunId, {
    completedSearchQueries: existing?.completedSearchQueries ?? [],
    extractedContentCount: (existing?.extractedContentCount ?? 0) + increment,
    currentSearchPhase: currentPhase,
    partialResultIds: existing?.partialResultIds ?? [],
    lastError: existing?.lastError,
  });
}

// ── Stage transition logging ────────────────────────────────────────────

/**
 * Log a stage transition on a TradeCandidate.
 * Appends to the `reprocessReason` field as a JSON transition log.
 * If the field already contains a transition log, appends to it.
 */
export async function logStageTransition(
  marketId: string,
  transition: StageTransition,
): Promise<void> {
  try {
    const candidate = await db.tradeCandidate.findUnique({
      where: { marketId },
      select: { reprocessReason: true },
    });
    if (!candidate) return;

    const log = parseTransitionLog(candidate.reprocessReason);
    log.push(transition);

    // Keep last 50 transitions max to avoid unbounded growth
    const trimmed = log.slice(-50);

    await db.tradeCandidate.update({
      where: { marketId },
      data: { reprocessReason: JSON.stringify(trimmed) },
    });
  } catch {
    // best-effort
  }
}

/**
 * Parse an existing transition log from the reprocessReason field.
 * Returns an empty array if the field doesn't contain a valid transition log.
 */
function parseTransitionLog(reprocessReason: string | null): StageTransition[] {
  if (!reprocessReason) return [];
  try {
    const parsed = JSON.parse(reprocessReason);
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0]?.from === 'string') {
      return parsed as StageTransition[];
    }
  } catch {
    // Not a valid transition log — could be a legacy reason string
  }
  return [];
}

/**
 * Read the stage transition log for a market's candidate.
 */
export async function getStageTransitionLog(marketId: string): Promise<StageTransition[]> {
  try {
    const candidate = await db.tradeCandidate.findUnique({
      where: { marketId },
      select: { reprocessReason: true },
    });
    return candidate ? parseTransitionLog(candidate.reprocessReason) : [];
  } catch {
    return [];
  }
}

// ── Failure checkpoint ──────────────────────────────────────────────────

/**
 * Save a failure checkpoint with error context for post-mortem / retry analysis.
 */
export async function saveFailureCheckpoint(
  jobId: string,
  errorMessage: string,
  stage?: string,
  state?: Record<string, unknown>,
): Promise<void> {
  await saveCheckpoint(
    jobId,
    {
      _failed: true,
      _errorMessage: errorMessage,
      _failedAt: new Date().toISOString(),
    },
    {
      stage: stage ?? 'FAILED',
      progress: 0,
      state,
    },
  );
}

// ── Cleanup ─────────────────────────────────────────────────────────────

/**
 * Delete a checkpoint when a job completes successfully.
 */
export async function deleteCheckpoint(jobId: string): Promise<void> {
  try {
    await db.researchCheckpoint.delete({ where: { jobId } });
  } catch {
    // May not exist – fine
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Rough progress estimate based on which phase of deep research we're in.
 */
function estimateResearchProgress(dp: DeepResearchProgress): number {
  const phaseMap: Record<string, number> = {
    WEB_SEARCH: 10,
    DEERFLOW: 30,
    TRADINGAGENTS: 50,
    AGENT_REACH: 70,
    SYNTHESIS: 90,
  };
  return phaseMap[dp.currentSearchPhase ?? 'WEB_SEARCH'] ?? 0;
}
