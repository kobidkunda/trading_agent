import { describe, expect, it } from 'bun:test';

import { getSimulationAccess } from '../simulation-access';

describe('simulation access', () => {
  it('allows DEMO mode and blocks PAPER/LIVE modes', () => {
    expect(getSimulationAccess('DEMO')).toEqual({
      allowed: true,
      reason: null,
    });

    expect(getSimulationAccess('PAPER')).toEqual({
      allowed: false,
      reason: 'SimulationLab mock templates are restricted to DEMO mode. Use PAPER mode through the trading market loop.',
    });

    expect(getSimulationAccess('LIVE')).toEqual({
      allowed: false,
      reason: 'Live execution requires safety gate confirmation. Use the trading market loop for LIVE mode.',
    });
  });
});
