import { NextRequest, NextResponse } from 'next/server';
import { enforceRoutePermission } from '@/lib/engine/auth';
import { getVenueProxySettings, saveVenueProxySettings, normalizeVenueProxySettings } from '@/lib/engine/venue-proxy-settings';

export async function GET(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/proxy-settings', 'GET');
  if (denied) return denied;

  try {
    const settings = await getVenueProxySettings();
    return NextResponse.json(settings);
  } catch {
    return NextResponse.json({ error: 'Failed to load proxy settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/proxy-settings', 'PUT');
  if (denied) return denied;

  try {
    const body = await request.json();
    const settings = normalizeVenueProxySettings(body);
    const saved = await saveVenueProxySettings(settings);
    return NextResponse.json(saved);
  } catch {
    return NextResponse.json({ error: 'Failed to save proxy settings' }, { status: 500 });
  }
}
