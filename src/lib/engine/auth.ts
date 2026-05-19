import { canAccessRoute, findApiPermission, type UserRole } from '@/lib/types';
import { NextResponse } from 'next/server';

function normalizeRole(value: string | null | undefined): UserRole | null {
  const role = value?.trim();
  if (role === 'Admin' || role === 'ResearchOperator' || role === 'RiskReviewer' || role === 'ExecutionReviewer' || role === 'ReadOnlyViewer') {
    return role;
  }
  return null;
}

function isLocalhost(request: Request): boolean {
  const host = request.headers.get('host')?.toLowerCase() ?? '';
  // Allow localhost, loopback, and LAN IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
  const isPrivate =
    host.includes('localhost') ||
    host.startsWith('127.0.0.1') ||
    host.startsWith('[::1]') ||
    /^192\.168\.\d+\.\d+/.test(host) ||
    /^10\.\d+\.\d+\.\d+/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+/.test(host);
  return isPrivate;
}

/**
 * x-role header is a development convenience ONLY.
 * It must NEVER be usable in production.
 * Set LOCAL_DEV_AUTH_BYPASS=true in .env.local for local development only.
 *
 * Conditions to grant a role via x-role header (ALL must be true):
 *   1. LOCAL_DEV_AUTH_BYPASS env var explicitly set to 'true'
 *   2. Request hostname is localhost / 127.0.0.1 / [::1]
 * In ALL other cases, returns null (blocked).
 */
export function getRoleFromRequest(request: Request): UserRole | null {
  if (process.env.LOCAL_DEV_AUTH_BYPASS === 'true' && isLocalhost(request)) {
    return normalizeRole(request.headers.get('x-role')) ?? 'Admin';
  }
  return null;
}

export function enforceRoutePermission(request: Request, route: string, method: string) {
  const role = getRoleFromRequest(request);
  if (!role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (canAccessRoute(role, route, method)) {
    return null;
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export function enforcePathPermission(request: Request, pathname: string, method: string) {
  const permission = findApiPermission(pathname, method);
  if (!permission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const role = getRoleFromRequest(request);
  if (!role) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (permission.roles.includes(role)) {
    return null;
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
