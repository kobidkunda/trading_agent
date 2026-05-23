import { describe, expect, it } from 'bun:test';

import { buildDegradedDebateResult } from '../debate-arena';
import { buildTriageFailureOutput, isAnalysisDegradedReason } from '../agents/triage';

describe('analysis degraded fail-closed contracts', () => {
  it('triage failure output blocks research and marks degraded status', () => {
    const result = buildTriageFailureOutput('API key required for remote API access');

    expect(result.status).toBe('ANALYSIS_DEGRADED');
    expect(result.worthResearch).toBe(false);
    expect(result.score).toBe(0);
    expect(isAnalysisDegradedReason(result.reason)).toBe(true);
  });

  it('degraded debate output forces skip with zero confidence', () => {
    const result = buildDegradedDebateResult(
      'Test market',
      0.42,
      'Arbiter agent failed after exhausting all fallback models',
    );

    expect(result.recommendation).toBe('SKIP');
    expect(result.finalProbability).toBe(0.42);
    expect(result.finalConfidence).toBe(0);
    expect(result.finalUncertainty).toBe(1);
    expect(result.recommendationReason).toContain('ANALYSIS_DEGRADED');
  });
});
