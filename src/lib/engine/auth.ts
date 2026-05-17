import { canAccessRoute, findApiPermission, type UserRole } from '@/lib/types';
import { NextResponse } from 'next/server';

function normalizeRole(value: string | null | undefined): UserRole | null {
  const role = value?.trim();
  if (role === 'Admin' || role === 'ResearchOperator' || role === 'RiskReviewer' || role === 'ExecutionReviewer' || role === 'ReadOnlyViewer') {
    return role;
  }

  return null;
}

export function getRoleFromRequest(request: Request): UserRole | null {
  if (process.env.LOCAL_DEV_AUTH_BYPASS === 'true') {
    return normalizeRole(request?.headers?.get?.('x-role')) ?? 'Admin';
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
