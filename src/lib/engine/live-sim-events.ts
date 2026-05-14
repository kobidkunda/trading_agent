import type { LiveActivityEvent, LiveMarketProgress, LivePipelineStage } from '../types';

export interface LiveSimulationActivityState {
  currentStage: LivePipelineStage | null;
  currentStageStartedAt: string | null;
  currentMarketTitle: string | null;
  activityEvents: LiveActivityEvent[];
  marketProgress: LiveMarketProgress[];
  lastCompletedMarket: { marketId: string; marketTitle: string; completedAt: string } | null;
  lastActivity: string | null;
}

export function createEmptyMarketProgress(marketId: string, marketTitle: string): LiveMarketProgress {
  return {
    marketId,
    marketTitle,
    currentStage: null,
    currentStageStartedAt: null,
    status: 'running',
    history: [],
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function createInitialActivityState(): LiveSimulationActivityState {
  return {
    currentStage: null,
    currentStageStartedAt: null,
    currentMarketTitle: null,
    activityEvents: [],
    marketProgress: [],
    lastCompletedMarket: null,
    lastActivity: null,
  };
}

export function appendLiveActivityEvent(
  events: LiveActivityEvent[],
  event: LiveActivityEvent,
  maxItems = 100,
): LiveActivityEvent[] {
  return [...events, event].slice(-maxItems);
}

export function updateMarketProgressStatus(
  progress: LiveMarketProgress,
  event: LiveActivityEvent,
): LiveMarketProgress {
  return {
    ...progress,
    currentStage: event.stage,
    currentStageStartedAt:
      event.type === 'started'
        ? event.timestamp
        : progress.currentStage !== event.stage
          ? null
          : progress.currentStageStartedAt,
    status:
      event.terminal === 'completed'
        ? 'completed'
        : event.terminal === 'failed' || event.type === 'failed'
          ? 'failed'
          : event.terminal === 'skipped' || event.type === 'skipped'
            ? 'skipped'
            : 'running',
    history: [...progress.history, event],
    lastUpdatedAt: event.timestamp,
  };
}

export function applyLiveActivityEventToState(
  state: LiveSimulationActivityState,
  event: LiveActivityEvent,
): LiveSimulationActivityState {
  const currentProgress =
    state.marketProgress.find((progress) => progress.marketId === event.marketId) ??
    createEmptyMarketProgress(event.marketId, event.marketTitle);
  const updatedProgress = updateMarketProgressStatus(currentProgress, event);

  return {
    ...state,
    currentStage: event.stage,
    currentStageStartedAt:
      event.type === 'started'
        ? event.timestamp
        : state.currentStage !== event.stage
          ? null
          : state.currentStageStartedAt,
    currentMarketTitle: event.marketTitle,
    activityEvents: appendLiveActivityEvent(state.activityEvents, event),
    marketProgress: [
      ...state.marketProgress.filter((progress) => progress.marketId !== event.marketId),
      updatedProgress,
    ],
    lastCompletedMarket:
      event.terminal === 'completed'
        ? {
            marketId: event.marketId,
            marketTitle: event.marketTitle,
            completedAt: event.timestamp,
          }
        : state.lastCompletedMarket,
    lastActivity: event.timestamp,
  };
}
