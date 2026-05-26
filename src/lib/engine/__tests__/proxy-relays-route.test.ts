import { beforeEach, describe, expect, it } from 'bun:test';

describe('proxy relays api', () => {
  const env = process.env as Record<string, string | undefined>;

  beforeEach(() => {
    env.NODE_ENV = 'production';
    env.LOCAL_DEV_AUTH_BYPASS = 'true';
  });

  it('rejects relay deployment without a platform token', async () => {
    const { POST } = await import('../../../app/api/proxy-relays/deploy/route');

    const response = await POST(
      new Request('http://localhost/api/proxy-relays/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'Admin' },
        body: JSON.stringify({
          platform: 'vercel',
          label: 'Relay',
          accountLabel: 'Account',
          projectName: 'relay-test',
        }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('token');
  });

  it('rejects Cloudflare deployment without an account id', async () => {
    const { POST } = await import('../../../app/api/proxy-relays/deploy/route');

    const response = await POST(
      new Request('http://localhost/api/proxy-relays/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'Admin' },
        body: JSON.stringify({
          platform: 'cloudflare',
          token: 'test-token',
          label: 'Relay',
          accountLabel: 'Account',
          projectName: 'relay-test',
        }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Account ID');
  });

  it('rejects Deno deployment without an organization domain', async () => {
    const { POST } = await import('../../../app/api/proxy-relays/deploy/route');

    const response = await POST(
      new Request('http://localhost/api/proxy-relays/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'Admin' },
        body: JSON.stringify({
          platform: 'deno',
          token: 'test-token',
          label: 'Relay',
          accountLabel: 'Account',
          projectName: 'relay-test',
        }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('organization domain');
  });
});
