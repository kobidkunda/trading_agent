import { afterEach, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { enforcePathPermission } from '@/lib/engine/auth';
import { canAccessRoute, findApiPermission } from '@/lib/types';

describe('api permission matrix', () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBypass = process.env.LOCAL_DEV_AUTH_BYPASS;

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    env.LOCAL_DEV_AUTH_BYPASS = originalBypass;
  });

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

  it('keeps diagnostic and reset endpoints admin-only', () => {
    expect(canAccessRoute('Admin', '/api/dbtest', 'GET')).toBe(true);
    expect(canAccessRoute('ReadOnlyViewer', '/api/dbtest', 'GET')).toBe(false);
    expect(canAccessRoute('Admin', '/api/test/sources', 'GET')).toBe(true);
    expect(canAccessRoute('ResearchOperator', '/api/test/sources', 'GET')).toBe(false);
    expect(canAccessRoute('Admin', '/api/reset', 'POST')).toBe(true);
    expect(canAccessRoute('ResearchOperator', '/api/reset', 'POST')).toBe(false);
  });

  it('requires authentication for non-public api routes', async () => {
    env.NODE_ENV = 'production';
    env.LOCAL_DEV_AUTH_BYPASS = 'false';
    const request = new Request('http://localhost/api/jobs', { method: 'GET' });
    const denied = enforcePathPermission(request, '/api/jobs', 'GET');
    expect(denied?.status).toBe(401);
  });

  it('rejects spoofed x-role headers when local bypass is disabled', () => {
    env.LOCAL_DEV_AUTH_BYPASS = 'false';
    const request = new Request('http://localhost/api/jobs', {
      method: 'GET',
      headers: { 'x-role': 'Admin' },
    });

    const denied = enforcePathPermission(request, '/api/jobs', 'GET');
    expect(denied?.status).toBe(401);
  });

  it('allows header role only when local bypass is enabled', () => {
    env.LOCAL_DEV_AUTH_BYPASS = 'true';
    const request = new Request('http://localhost/api/jobs', {
      method: 'GET',
      headers: { 'x-role': 'Admin' },
    });

    const denied = enforcePathPermission(request, '/api/jobs', 'GET');
    expect(denied).toBeNull();
  });

  it('covers every implemented route method with an explicit permission', () => {
    const routes: Array<{ route: string; methods: string[] }> = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
          continue;
        }
        if (entry.name !== 'route.ts') {
          continue;
        }

        const relativePath = path.relative(process.cwd(), entryPath);
        const route = `/${relativePath.replace(/^src\/app\//, '').replace(/\/route\.ts$/, '')}`;
        const source = readFileSync(entryPath, 'utf8');
        const methods = [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\b/g)].map(
          (match) => match[1],
        );

        routes.push({ route, methods });
      }
    }

    walk(path.join(process.cwd(), 'src/app/api'));

    const missing = routes.flatMap(({ route, methods }) =>
      methods
        .filter((method) => findApiPermission(route, method) === null)
        .map((method) => `${route} ${method}`),
    );

    expect(missing).toEqual([]);
  });
});
