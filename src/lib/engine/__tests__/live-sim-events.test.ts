import { describe, expect, it, mock } from 'bun:test';

import {
  appendLiveActivityEvent,
  applyLiveActivityEventToState,
  createEmptyMarketProgress,
  createInitialActivityState,
  updateMarketProgressStatus,
} from '../live-sim-events';
import type { LiveActivityEvent } from '@/lib/types';

describe('live simulation events', () => {
  it('records stage activity without treating generic completion as market completion', () => {
    const startedAt = '2026-04-19T10:00:00.000Z';
    const completedAt = '2026-04-19T10:00:05.000Z';
    const progress = createEmptyMarketProgress('m1', 'Test market');

    const started = updateMarketProgressStatus(progress, {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'TRIAGE',
      type: 'started',
      timestamp: startedAt,
      message: 'Triage started',
    });

    const completed = updateMarketProgressStatus(started, {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'TRIAGE',
      type: 'completed',
      message: 'Triage completed',
      timestamp: completedAt,
    });

    const events = appendLiveActivityEvent([], {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'TRIAGE',
      type: 'completed',
      message: 'Triage completed',
      timestamp: completedAt,
    });

    expect(completed.currentStage).toBe('TRIAGE');
    expect(completed.currentStageStartedAt).toBe(startedAt);
    expect(completed.status).toBe('running');
    expect(completed.history).toHaveLength(2);
    expect(events[0].type).toBe('completed');
  });

  it('only sets stage started timestamps on started events and supports terminal completion events', () => {
    const startedAt = '2026-04-19T10:00:00.000Z';
    const progressAt = '2026-04-19T10:00:01.000Z';
    const stageCompletedAt = '2026-04-19T10:00:05.000Z';
    const marketCompletedAt = '2026-04-19T10:00:06.000Z';

    const started = applyLiveActivityEventToState(createInitialActivityState(), {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'SCAN',
      type: 'started',
      message: 'Scanning market',
      timestamp: startedAt,
      provider: 'system',
    });

    const progressed = applyLiveActivityEventToState(started, {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'SCAN',
      type: 'progress',
      message: 'Market created and queued',
      timestamp: progressAt,
      provider: 'system',
    });

    const stageCompleted = applyLiveActivityEventToState(progressed, {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'DECISION',
      type: 'completed',
      message: 'Decision stage completed',
      timestamp: stageCompletedAt,
      provider: 'system',
    });

    const marketCompleted = applyLiveActivityEventToState(stageCompleted, {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'DECISION',
      type: 'completed',
      message: 'Pipeline completed successfully',
      timestamp: marketCompletedAt,
      provider: 'system',
      terminal: 'completed',
    });

    expect(started.currentStage).toBe('SCAN');
    expect(started.currentStageStartedAt).toBe(startedAt);
    expect(progressed.activityEvents).toHaveLength(2);
    expect(progressed.currentStageStartedAt).toBe(startedAt);
    expect(progressed.marketProgress[0].history).toHaveLength(2);
    expect(progressed.marketProgress[0].currentStageStartedAt).toBe(startedAt);
    expect(stageCompleted.currentStage).toBe('DECISION');
    expect(stageCompleted.currentStageStartedAt).toBeNull();
    expect(stageCompleted.marketProgress[0].status).toBe('running');
    expect(stageCompleted.lastCompletedMarket).toBeNull();
    expect(marketCompleted.currentStageStartedAt).toBeNull();
    expect(marketCompleted.marketProgress[0].status).toBe('completed');
    expect(marketCompleted.lastCompletedMarket).toEqual({
      marketId: 'm1',
      marketTitle: 'Test market',
      completedAt: marketCompletedAt,
    });
  });

  it('captures sequential pipeline stage callbacks in live activity state', () => {
    const stageEvents: LiveActivityEvent[] = [
      {
        marketId: 'm1',
        marketTitle: 'Test market',
        stage: 'TRIAGE',
        type: 'started',
        message: 'Running triage',
        timestamp: '2026-04-19T10:00:00.000Z',
        provider: 'system',
      },
      {
        marketId: 'm1',
        marketTitle: 'Test market',
        stage: 'DEERFLOW',
        type: 'started',
        message: 'Running DeerFlow research',
        timestamp: '2026-04-19T10:00:01.000Z',
        provider: 'deerflow',
      },
      {
        marketId: 'm1',
        marketTitle: 'Test market',
        stage: 'TRADINGAGENTS',
        type: 'started',
        message: 'Running TradingAgents analysts',
        timestamp: '2026-04-19T10:00:02.000Z',
        provider: 'tradingagents',
      },
      {
        marketId: 'm1',
        marketTitle: 'Test market',
        stage: 'SYNTHESIS',
        type: 'started',
        message: 'Synthesizing research findings',
        timestamp: '2026-04-19T10:00:03.000Z',
        provider: 'system',
      },
      {
        marketId: 'm1',
        marketTitle: 'Test market',
        stage: 'JUDGE',
        type: 'started',
        message: 'Running judge debate arena',
        timestamp: '2026-04-19T10:00:04.000Z',
        provider: 'system',
      },
      {
        marketId: 'm1',
        marketTitle: 'Test market',
        stage: 'RISK',
        type: 'started',
        message: 'Running deterministic risk engine',
        timestamp: '2026-04-19T10:00:05.000Z',
        provider: 'system',
      },
    ];

    const stageNames = ['TRIAGE', 'DEERFLOW', 'TRADINGAGENTS', 'SYNTHESIS', 'JUDGE', 'RISK'] as const;

    let state = createInitialActivityState();

    for (const event of stageEvents) {
      state = applyLiveActivityEventToState(state, event);
    }

    expect(state.activityEvents.map((event) => event.stage)).toEqual([...stageNames]);
    expect(state.activityEvents.map((event) => event.provider)).toEqual([
      'system',
      'deerflow',
      'tradingagents',
      'system',
      'system',
      'system',
    ]);
    expect(state.currentStage).toBe('RISK');
    expect(state.currentStageStartedAt).toBe('2026-04-19T10:00:05.000Z');
    expect(state.marketProgress[0].history.map((event) => event.stage)).toEqual([...stageNames]);
    expect(state.marketProgress[0].currentStage).toBe('RISK');
    expect(state.marketProgress[0].currentStageStartedAt).toBe('2026-04-19T10:00:05.000Z');
  });

  it('tracks resolution checks through the shared activity helper path', () => {
    const state = applyLiveActivityEventToState(createInitialActivityState(), {
      marketId: 'resolution-cycle',
      marketTitle: 'Resolution check',
      stage: 'RESOLUTION_CHECK',
      type: 'started',
      message: 'Checking paper bet resolutions',
      timestamp: '2026-04-19T10:01:00.000Z',
      provider: 'system',
    });

    expect(state.currentStage).toBe('RESOLUTION_CHECK');
    expect(state.currentStageStartedAt).toBe('2026-04-19T10:01:00.000Z');
    expect(state.currentMarketTitle).toBe('Resolution check');
    expect(state.activityEvents).toHaveLength(1);
    expect(state.marketProgress[0].currentStage).toBe('RESOLUTION_CHECK');
  });

  it.skip('resets paper bet counters when a new simulation starts', async () => {
    const paperBetCountMock = mock(async () => 0);
    paperBetCountMock.mockResolvedValueOnce(4);
    paperBetCountMock.mockResolvedValueOnce(3);

    mock.module('@/lib/db', () => ({
      db: {
        paperBet: {
          count: paperBetCountMock,
        },
        settings: {
          findUnique: mock(async () => ({ key: 'trading_mode', value: 'PAPER' })),
        },
      },
    }));
    mock.module('@/lib/engine/scanner', () => ({
      runScanner: mock(async () => ({
        totalScanned: 0,
        totalNew: 0,
      })),
    }));
    mock.module('@/lib/engine/resolution-poller', () => ({
      runResolutionCycle: mock(async () => ({ resolved: 2, scored: 2 })),
    }));

    mock.module('@/lib/engine/live-simulation', () =>
      import(new URL('../live-simulation.ts?reset-counter-test', import.meta.url).href),
    );

    const liveSimulation = await import('@/lib/engine/live-simulation');

    await liveSimulation.startSimulation({ scanIntervalSec: 999999, marketsPerScan: 0 });
    await new Promise((resolve) => setTimeout(resolve, 2100));

    expect(liveSimulation.getSimState().paperBetsResolved).toBe(2);
    expect(liveSimulation.getSimState().paperBetAccuracy).toBe(75);

    liveSimulation.stopSimulation();
    await liveSimulation.startSimulation({ scanIntervalSec: 999999, marketsPerScan: 0 });

    expect(liveSimulation.getSimState().paperBetsResolved).toBe(0);
    expect(liveSimulation.getSimState().paperBetAccuracy).toBe(0);

    liveSimulation.stopSimulation();
  });

  it('preserves serviceName and model fields on stage events', () => {
    const event: LiveActivityEvent = {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'DEERFLOW',
      type: 'started',
      message: 'Running DeerFlow research',
      timestamp: '2026-04-19T10:00:00.000Z',
      provider: 'deerflow',
      serviceName: 'deerflow',
      model: 'gpt-4o',
    };

    const state = applyLiveActivityEventToState(createInitialActivityState(), event);

    expect(state.activityEvents).toHaveLength(1);
    expect(state.activityEvents[0].serviceName).toBe('deerflow');
    expect(state.activityEvents[0].model).toBe('gpt-4o');
    expect(state.marketProgress[0].history[0].serviceName).toBe('deerflow');
    expect(state.marketProgress[0].history[0].model).toBe('gpt-4o');
  });

  it('preserves failureReason on failed events', () => {
    const event: LiveActivityEvent = {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'TRADINGAGENTS',
      type: 'failed',
      message: 'TradingAgents failed',
      timestamp: '2026-04-19T10:00:00.000Z',
      provider: 'tradingagents',
      serviceName: 'tradingagents',
      model: 'claude-3',
      failureReason: 'API timeout after 30s',
    };

    const state = applyLiveActivityEventToState(createInitialActivityState(), event);

    expect(state.activityEvents[0].failureReason).toBe('API timeout after 30s');
    expect(state.activityEvents[0].type).toBe('failed');
    expect(state.marketProgress[0].status).toBe('failed');
  });

  it('preserves summary and references fields on stage events', () => {
    const references = [
      {
        title: 'Test Article',
        url: 'https://example.com/article',
        domain: 'example.com',
        snippet: 'Test snippet content',
        provider: 'search',
        reasonIncluded: 'relevant to market',
      },
    ];

    const event: LiveActivityEvent = {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'SYNTHESIS',
      type: 'completed',
      message: 'Synthesis completed',
      timestamp: '2026-04-19T10:00:00.000Z',
      provider: 'system',
      serviceName: 'synthesis',
      model: 'gpt-4o',
      summary: 'Consensus probability: 75%',
      references,
    };

    const state = applyLiveActivityEventToState(createInitialActivityState(), event);

    expect(state.activityEvents[0].summary).toBe('Consensus probability: 75%');
    expect(state.activityEvents[0].references).toEqual(references);
    expect(state.activityEvents[0].references).toHaveLength(1);
    expect(state.activityEvents[0].references![0].title).toBe('Test Article');
  });
});
