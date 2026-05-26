import { describe, expect, it } from 'bun:test';
import { selectRelayCandidates } from '@/lib/engine/relay-pool';
import type { ProxyRelay } from '@/lib/engine/venue-proxy-settings';

function relay(overrides: Partial<ProxyRelay>): ProxyRelay {
  return {
    id: 'relay-1',
    label: 'Relay 1',
    platform: 'vercel',
    accountLabel: 'Account',
    baseUrl: 'https://relay.example.com',
    status: 'UNTESTED',
    enabled: true,
    ...overrides,
  };
}

describe('relay pool selection', () => {
  it('skips disabled and down relays', () => {
    const candidates = selectRelayCandidates([
      relay({ id: 'disabled', enabled: false, status: 'DISABLED' }),
      relay({ id: 'down', status: 'DOWN' }),
      relay({ id: 'up', status: 'UP' }),
    ]);

    expect(candidates.map((item) => item.id)).toEqual(['up']);
  });

  it('prefers the active relay before status ranking', () => {
    const candidates = selectRelayCandidates([
      relay({ id: 'fast', status: 'UP' }),
      relay({ id: 'preferred', status: 'DEGRADED' }),
    ], 'preferred');

    expect(candidates.map((item) => item.id)).toEqual(['preferred', 'fast']);
  });

  it('ranks healthy relays before untested and degraded relays', () => {
    const candidates = selectRelayCandidates([
      relay({ id: 'degraded', status: 'DEGRADED' }),
      relay({ id: 'untested', status: 'UNTESTED' }),
      relay({ id: 'up', status: 'UP' }),
    ]);

    expect(candidates.map((item) => item.id)).toEqual(['up', 'untested', 'degraded']);
  });
});
