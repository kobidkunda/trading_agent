import { describe, expect, it } from 'bun:test';
import { canAccessRoute, findApiPermission } from '@/lib/types';

describe('api permission matrix', () => {
  it('matches dynamic route patterns', () => {
    const permission = findApiPermission('/api/market/abc/detail', 'GET');
    expect(permission?.route).toBe('/api/market/[id]/detail');
  });

  it('defaults unknown api routes to deny', () => {
    expect(findApiPermission('/api/unknown/path', 'GET')).toBeNull();
    expect(canAccessRoute('Admin', '/api/unknown/path', 'GET')).toBe(false);
  });

  it('keeps trading mode mutation admin-only', () => {
    expect(canAccessRoute('Admin', '/api/trading/mode', 'POST')).toBe(true);
    expect(canAccessRoute('ResearchOperator', '/api/trading/mode', 'POST')).toBe(false);
  });
});
