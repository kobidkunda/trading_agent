import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { enforcePathPermission } from '@/lib/engine/auth';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (pathname === '/api/health') {
    return NextResponse.next();
  }

  const denied = enforcePathPermission(request, pathname, request.method);
  if (denied) {
    return denied;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
