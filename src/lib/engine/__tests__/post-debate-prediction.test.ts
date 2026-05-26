import { describe, expect, it } from 'bun:test';
import type { DebateArenaResult } from '../debate-arena';
import { runPostDebatePrediction } from '../post-debate-prediction';

const debateResult: DebateArenaResult = {
  rounds: [
    {
      round: 1,
      bullModel: 'bull',
      bearModel: 'bear',
      bullArgument: 'Bull case',
      bearArgument: 'Bear case',
      bullProbability: 0.62,
      bearProbability: 0.48,
      bullConfidence: 0.7,
      bearConfidence: 0.6,
    },
  ],
  bullConsensus: {
    probability: 0.62,
    confidence: 0.7,
    keyArguments: ['Bull evidence is stronger'],
  },
  bearConsensus: {
    probability: 0.48,
    confidence: 0.6,
    keyArguments: ['Bear evidence exists'],
  },
  pointsOfAgreement: ['The market has enough evidence to judge'],
  pointsOfDisagreement: ['The size of the edge is disputed'],
  debateOutcome: 'BULL_WINS',
  finalProbability: 0.6,
  finalConfidence: 0.72,
  finalUncertainty: 0.28,
  proEvidence: ['pro'],
  antiEvidence: ['anti'],
  recommendation: 'BID',
  recommendationReason: 'Bull edge is actionable',
};

describe('post-debate prediction', () => {
  it('uses deterministic debate synthesis when MiroFish URL is not configured', async () => {
    const oldUrl = process.env.MIROFISH_URL;
    delete process.env.MIROFISH_URL;

    try {
      const result = await runPostDebatePrediction(debateResult, 'Research context');

      expect(result.modelUsed).toBe('fallback-synthesis');
      expect(result.finalConfidence).toBeGreaterThanOrEqual(debateResult.finalConfidence);
      expect(result.summary).toContain('BULL_WINS');
      expect(result.recommendation).toBe('BID');
    } finally {
      if (oldUrl) {
        process.env.MIROFISH_URL = oldUrl;
      }
    }
  });
});
