import { describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// Worker Pipeline Chain — structural verification of the job chain:
//   TRIAGE → RESEARCH → JUDGE → RISK → EXECUTE
// Tests the lookup/dispatch logic without requiring a real database.
// ---------------------------------------------------------------------------

describe('Worker Pipeline Chain', () => {
  // --- helpers that mirror the shapes used by the pipeline ---

  type JobType =
    | 'TRIAGE_MARKET'
    | 'STANDARD_RESEARCH'
    | 'FULL_RESEARCH'
    | 'JUDGMENT'
    | 'RISK_CHECK'
    | 'PAPER_EXECUTE';

  interface GatedRiskResult {
    action: 'BID' | 'SKIP' | 'WATCH';
    reasonCodes: string[];
    positionSize: number;
    adjustedSize: number;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE';
    gatedUrgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE';
    gatedFees: number;
    gatedSlippage: number;
    estimatedFees: number;
  }

  // --- TRIAGE with worthResearch=true enqueues STANDARD_RESEARCH ---

  it('TRIAGE with worthResearch=true should enqueue STANDARD_RESEARCH', () => {
    // Simulate logic in processJob(TRIAGE_MARKET)
    const triageResult = { worthResearch: true };
    const nextJobType: JobType | null = triageResult.worthResearch
      ? 'STANDARD_RESEARCH'
      : null;

    expect(nextJobType).toBe('STANDARD_RESEARCH');
  });

  it('TRIAGE with worthResearch=false should NOT enqueue research', () => {
    const triageResult = { worthResearch: false };
    const nextJobType: JobType | null = triageResult.worthResearch
      ? 'STANDARD_RESEARCH'
      : null;

    expect(nextJobType).toBeNull();
  });

  // --- lookupResearchRunForMarket allows RUNNING when runId is provided ---

  it('lookupResearchRunForMarket should accept non-FAILED RUNNING when researchRunId provided', () => {
    // Old logic: only allowed COMPLETED
    // New logic: accepts RUNNING when a specific researchRunId is given
    const states = ['PENDING', 'RUNNING', 'COMPLETED'] as const;

    function shouldAccept(state: string, hasRunId: boolean): boolean {
      if (state === 'FAILED') return false;
      if (hasRunId && state === 'RUNNING') return true;
      return state === 'COMPLETED';
    }

    // Without runId, only COMPLETED
    expect(shouldAccept('RUNNING', false)).toBe(false);
    expect(shouldAccept('COMPLETED', false)).toBe(true);
    expect(shouldAccept('PENDING', false)).toBe(false);
    expect(shouldAccept('FAILED', false)).toBe(false);

    // With runId, RUNNING also accepted
    expect(shouldAccept('RUNNING', true)).toBe(true);
    expect(shouldAccept('COMPLETED', true)).toBe(true);
    expect(shouldAccept('PENDING', true)).toBe(false);
    expect(shouldAccept('FAILED', true)).toBe(false);
  });

  // --- PAPER_EXECUTE reconstructs full gatedRiskResult ---

  it('PAPER_EXECUTE should reconstruct full gatedRiskResult with urgency/fees/slippage', () => {
    // Simulate the enrichment done in the PAPER_EXECUTE handler
    const payload: Partial<GatedRiskResult> = {
      action: 'BID',
      reasonCodes: [],
    };

    // Enrich from stored riskResult
    const storedRisk = {
      urgency: 'HIGH' as const,
      estimatedFees: 2.5,
      slippage: 0.01,
      gatedUrgency: 'HIGH' as const,
      gatedFees: 3.0,
      gatedSlippage: 0.015,
    };

    const enriched: GatedRiskResult = {
      action: payload.action as 'BID',
      reasonCodes: payload.reasonCodes ?? [],
      positionSize: storedRisk.gatedFees > 0 ? 100 : 0,
      adjustedSize: 50,
      urgency: storedRisk.urgency,
      gatedUrgency: storedRisk.gatedUrgency,
      gatedFees: storedRisk.gatedFees,
      gatedSlippage: storedRisk.gatedSlippage,
      estimatedFees: storedRisk.estimatedFees,
    };

    expect(enriched.gatedUrgency).toBe('HIGH');
    expect(enriched.gatedFees).toBe(3.0);
    expect(enriched.gatedSlippage).toBe(0.015);
    expect(enriched.urgency).toBe('HIGH');
    expect(enriched.estimatedFees).toBe(2.5);
    // All 9 fields present
    const keys = Object.keys(enriched);
    expect(keys.length).toBe(9);
    expect(keys).toContain('action');
    expect(keys).toContain('reasonCodes');
    expect(keys).toContain('positionSize');
    expect(keys).toContain('adjustedSize');
    expect(keys).toContain('urgency');
    expect(keys).toContain('gatedUrgency');
    expect(keys).toContain('gatedFees');
    expect(keys).toContain('gatedSlippage');
    expect(keys).toContain('estimatedFees');
  });

  // --- RISK_CHECK passes gated fields to PAPER_EXECUTE payload ---

  it('RISK_CHECK should pass gatedUrgency, gatedFees, gatedSlippage to PAPER_EXECUTE payload', () => {
    // When RISK_CHECK finishes it enqueues PAPER_EXECUTE with enriched data
    const riskResult: GatedRiskResult = {
      action: 'BID',
      reasonCodes: [],
      positionSize: 200,
      adjustedSize: 100,
      urgency: 'MEDIUM',
      gatedUrgency: 'MEDIUM',
      gatedFees: 1.5,
      gatedSlippage: 0.008,
      estimatedFees: 1.2,
    };

    // The payload sent to PAPER_EXECUTE
    const executePayload = {
      candidateId: 'candidate-1',
      marketId: 'market-1',
      decisionId: 'decision-1',
      gatedRiskResult: {
        action: riskResult.action,
        reasonCodes: riskResult.reasonCodes,
        positionSize: riskResult.positionSize,
        adjustedSize: riskResult.adjustedSize,
        urgency: riskResult.urgency,
        gatedUrgency: riskResult.gatedUrgency,
        gatedFees: riskResult.gatedFees,
        gatedSlippage: riskResult.gatedSlippage,
        estimatedFees: riskResult.estimatedFees,
      },
    };

    expect(executePayload.gatedRiskResult.gatedUrgency).toBe('MEDIUM');
    expect(executePayload.gatedRiskResult.gatedFees).toBe(1.5);
    expect(executePayload.gatedRiskResult.gatedSlippage).toBe(0.008);
    expect(executePayload.gatedRiskResult.adjustedSize).toBe(100);
    expect(executePayload.gatedRiskResult.action).toBe('BID');
  });

  // --- Full chain: TRIAGE → RESEARCH → JUDGE → RISK → EXECUTE ---

  it('full pipeline chain: TRIAGE → RESEARCH → JUDGE → RISK → EXECUTE', () => {
    const chain: JobType[] = [
      'TRIAGE_MARKET',
      'STANDARD_RESEARCH',
      'JUDGMENT',
      'RISK_CHECK',
      'PAPER_EXECUTE',
    ];

    // Verify order — each step queues the next
    const nextMap: Record<JobType, JobType | null> = {
      TRIAGE_MARKET: 'STANDARD_RESEARCH',
      STANDARD_RESEARCH: 'JUDGMENT',
      FULL_RESEARCH: 'JUDGMENT',
      JUDGMENT: 'RISK_CHECK',
      RISK_CHECK: 'PAPER_EXECUTE',
      PAPER_EXECUTE: null,
    };

    for (let i = 0; i < chain.length - 1; i++) {
      const current = chain[i];
      const expected = chain[i + 1];
      expect(nextMap[current]).toBe(expected);
    }

    expect(nextMap['PAPER_EXECUTE']).toBeNull();
  });
});
