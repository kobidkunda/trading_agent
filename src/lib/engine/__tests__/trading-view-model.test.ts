import { describe, expect, it } from 'bun:test';

import {
  getModeDisplayCopy,
  getModeToggleTarget,
  isLiveRiskBannerVisible,
} from '../trading-view-model';

describe('trading view model', () => {
  it('renders demo mode copy correctly', () => {
    const copy = getModeDisplayCopy('DEMO');

    expect(copy.label).toBe('DEMO MODE');
    expect(copy.description).toBe('Mock markets and simulated execution for UI testing');
    expect(copy.badgeTone).toBe('amber');
  });

  it('renders paper mode copy correctly', () => {
    const copy = getModeDisplayCopy('PAPER');

    expect(copy.label).toBe('PAPER MODE');
    expect(copy.description).toBe('Real market data with simulated paper execution');
    expect(copy.badgeTone).toBe('emerald');
  });

  it('renders live mode copy correctly', () => {
    const copy = getModeDisplayCopy('LIVE');

    expect(copy.label).toBe('LIVE MODE');
    expect(copy.description).toBe('Real market data with real execution when safety allows');
    expect(copy.badgeTone).toBe('red');
  });

  it('cycles toggle target between demo, paper, and live', () => {
    expect(getModeToggleTarget('DEMO')).toBe('PAPER');
    expect(getModeToggleTarget('PAPER')).toBe('LIVE');
    expect(getModeToggleTarget('LIVE')).toBe('PAPER');
  });

  it('shows risk banner only for live mode', () => {
    expect(isLiveRiskBannerVisible('DEMO')).toBe(false);
    expect(isLiveRiskBannerVisible('PAPER')).toBe(false);
    expect(isLiveRiskBannerVisible('LIVE')).toBe(true);
  });
});
