import { describe, expect, it } from 'bun:test';

import { getPipelineModeSummary } from '../pipeline-settings-view-model';

describe('pipeline settings view model', () => {
  it('summarizes demo mode correctly', () => {
    expect(getPipelineModeSummary('DEMO')).toEqual({
      title: 'DEMO mode',
      dataSource: 'MOCK',
      executionMode: 'SIMULATED',
      warning: 'Mock templates only. Do not treat results as real trading signals.',
    });
  });

  it('summarizes paper mode correctly', () => {
    expect(getPipelineModeSummary('PAPER')).toEqual({
      title: 'PAPER mode',
      dataSource: 'REAL',
      executionMode: 'SIMULATED',
      warning: 'Real venue data with simulated execution.',
    });
  });

  it('summarizes live mode correctly', () => {
    expect(getPipelineModeSummary('LIVE')).toEqual({
      title: 'LIVE mode',
      dataSource: 'REAL',
      executionMode: 'REAL',
      warning: 'Safety-gated live execution path.',
    });
  });
});
