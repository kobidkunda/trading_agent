import { canAccessRoute, findApiPermission, type UserRole } from '@/lib/types';
import { NextResponse } from 'next/server';

export function getRoleFromRequest(request: Request): UserRole {
  const role = request?.headers?.get?.('x-role')?.trim();
  if (role === 'Admin' || role === 'ResearchOperator' || role === 'RiskReviewer' || role === 'ExecutionReviewer' || role === 'ReadOnlyViewer') {
    return role;
  }
  if (process.env.LOCAL_DEV_AUTH_BYPASS === 'true') {
    return 'Admin';
  }
  return 'ReadOnlyViewer';
}

export function enforceRoutePermission(request: Request, route: string, method: string) {
  const role = getRoleFromRequest(request);
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
  if (permission.roles.includes(role)) {
    return null;
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
