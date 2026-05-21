import { describe, expect, it } from 'bun:test';

import { getSimulationAccess } from '../simulation-access';

describe('simulation access', () => {
  it('allows DEMO and PAPER modes, blocks LIVE mode', () => {
    expect(getSimulationAccess('DEMO')).toEqual({
      allowed: true,
      reason: null,
    });

    expect(getSimulationAccess('PAPER')).toEqual({
      allowed: true,
      reason: null,
    });

    expect(getSimulationAccess('LIVE')).toEqual({
      allowed: false,
      reason: 'Live execution requires safety gate confirmation. Use the trading market loop for LIVE mode.',
    });
  });
});
