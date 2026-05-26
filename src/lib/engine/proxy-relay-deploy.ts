import type { RelayPlatform } from '@/lib/engine/venue-proxy-settings';

export interface DeployRelayInput {
  platform: RelayPlatform;
  token: string;
  projectName: string;
  accountId?: string;
  orgDomain?: string;
}

export interface DeployRelayResult {
  baseUrl: string;
  deploymentId: string | null;
  logs: string[];
  metadata: Record<string, unknown>;
}

const RELAY_FUNCTION_CODE = `
export const config = { runtime: "edge" };

function cleanRelayHeaders(inputHeaders) {
  const headers = new Headers(inputHeaders);
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("accept-encoding");
  return headers;
}

export default async function handler(req) {
  try {
    const target = req.headers.get("x-relay-target");
    const relayPath = req.headers.get("x-relay-path") || "/";
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    const targetUrl = target.replace(/\\/$/, "") + relayPath;
    const headers = cleanRelayHeaders(req.headers);
    const init = {
      method: req.method,
      headers
    };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = req.body;
      init.duplex = "half";
    }
    const response = await fetch(targetUrl, init);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 502,
      headers: { "content-type": "application/json" }
    });
  }
}
`;

const CLOUDFLARE_WORKER_CODE = `
function cleanRelayHeaders(inputHeaders) {
  const headers = new Headers(inputHeaders);
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("accept-encoding");
  return headers;
}

export default {
  async fetch(request) {
    try {
      const target = request.headers.get("x-relay-target");
      const relayPath = request.headers.get("x-relay-path") || "/";
      if (!target) {
        return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      }
      const targetUrl = target.replace(/\\/$/, "") + relayPath;
      const headers = cleanRelayHeaders(request.headers);
      const init = {
        method: request.method,
        headers
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
        init.duplex = "half";
      }
      const response = await fetch(targetUrl, init);
      return new Response(response.body, {
        status: response.status,
        headers: response.headers
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
        status: 502,
        headers: { "content-type": "application/json" }
      });
    }
  }
};
`;

const DENO_RELAY_CODE = `
function cleanRelayHeaders(inputHeaders) {
  const headers = new Headers(inputHeaders);
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("accept-encoding");
  return headers;
}

Deno.serve(async (request) => {
  try {
    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    const targetUrl = target.replace(/\\/$/, "") + relayPath;
    const headers = cleanRelayHeaders(request.headers);
    const init = {
      method: request.method,
      headers
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    const response = await fetch(targetUrl, init);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 502,
      headers: { "content-type": "application/json" }
    });
  }
});
`;

function slugifyProjectName(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return slug || `relay-${Date.now().toString(36)}`;
}

async function readApiError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const error = data.error as { message?: string } | undefined;
    if (error?.message) return error.message;
    const errors = data.errors as Array<{ message?: string }> | undefined;
    if (errors?.[0]?.message) return errors[0].message;
    if (typeof data.message === 'string') return data.message;
  } catch {}
  return text.slice(0, 500);
}

export async function deployRelay(input: DeployRelayInput): Promise<DeployRelayResult> {
  if (input.platform === 'vercel') return deployVercelRelay(input);
  if (input.platform === 'cloudflare') return deployCloudflareRelay(input);
  return deployDenoRelay(input);
}

async function deployVercelRelay(input: DeployRelayInput): Promise<DeployRelayResult> {
  const logs = ['Validated Vercel token input', 'Uploading relay deployment to Vercel'];
  const projectName = slugifyProjectName(input.projectName);
  const response = await fetch('https://api.vercel.com/v13/deployments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: projectName,
      target: 'production',
      files: [
        { file: 'api/relay.js', data: RELAY_FUNCTION_CODE },
        { file: 'package.json', data: JSON.stringify({ name: projectName, version: '1.0.0', private: true }) },
        { file: 'vercel.json', data: JSON.stringify({ rewrites: [{ source: '/(.*)', destination: '/api/relay' }] }) },
      ],
      projectSettings: { framework: null },
    }),
  });
  if (!response.ok) throw new Error(await readApiError(response));
  const data = await response.json() as Record<string, unknown>;
  const url = String(data.url || '');
  if (!url) throw new Error('Vercel deployment did not return a URL');
  logs.push('Vercel accepted relay deployment');
  const projectId = String(data.projectId || projectName);
  const protectionResponse = await fetch(`https://api.vercel.com/v9/projects/${projectId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ssoProtection: null,
      passwordProtection: null,
    }),
  }).catch((error) => {
    logs.push(`Vercel protection update skipped: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (protectionResponse?.ok) {
    logs.push('Vercel deployment protection disabled for relay access');
  } else if (protectionResponse) {
    logs.push(`Vercel protection update returned HTTP ${protectionResponse.status}`);
  }
  return {
    baseUrl: `https://${url.replace(/^https?:\/\//, '')}`,
    deploymentId: String(data.id || data.uid || '') || null,
    logs,
    metadata: { projectName, projectId },
  };
}

async function deployCloudflareRelay(input: DeployRelayInput): Promise<DeployRelayResult> {
  if (!input.accountId) throw new Error('Cloudflare Account ID is required');
  const logs = ['Validated Cloudflare token input', 'Uploading relay worker to Cloudflare'];
  const projectName = slugifyProjectName(input.projectName);
  const formData = new FormData();
  formData.append('index.js', new Blob([CLOUDFLARE_WORKER_CODE], { type: 'application/javascript+module' }), 'index.js');
  formData.append('metadata', new Blob([JSON.stringify({
    main_module: 'index.js',
    compatibility_date: '2026-05-26',
  })], { type: 'application/json' }), 'metadata.json');

  const upload = await fetch(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/workers/scripts/${projectName}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${input.token}` },
    body: formData,
  });
  if (!upload.ok) throw new Error(await readApiError(upload));
  logs.push('Cloudflare worker uploaded');

  await fetch(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/workers/scripts/${projectName}/subdomain`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enabled: true }),
  }).catch(() => null);

  const subdomainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${input.accountId}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${input.token}` },
  });
  if (!subdomainRes.ok) throw new Error(await readApiError(subdomainRes));
  const subdomainData = await subdomainRes.json() as { result?: { subdomain?: string } };
  const subdomain = subdomainData.result?.subdomain;
  if (!subdomain) throw new Error('Cloudflare account has no workers.dev subdomain configured');
  logs.push('Cloudflare workers.dev subdomain resolved');

  return {
    baseUrl: `https://${projectName}.${subdomain}.workers.dev`,
    deploymentId: projectName,
    logs,
    metadata: { projectName, accountId: input.accountId },
  };
}

async function deployDenoRelay(input: DeployRelayInput): Promise<DeployRelayResult> {
  if (!input.orgDomain) throw new Error('Deno organization domain is required');
  const logs = ['Validated Deno token input', 'Creating Deno Deploy app'];
  const projectName = slugifyProjectName(input.projectName);
  const appRes = await fetch('https://api.deno.com/v2/apps', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      slug: projectName,
      labels: { 'tradingbot.kind': 'market-relay' },
      config: {
        runtime: { type: 'dynamic', entrypoint: 'main.ts' },
      },
    }),
  });
  if (!appRes.ok && appRes.status !== 409) throw new Error(await readApiError(appRes));
  const appData = appRes.status === 409 ? { id: projectName } : await appRes.json() as Record<string, unknown>;
  const appId = String(appData.id || appData.slug || projectName);
  logs.push('Uploading Deno relay deployment');

  const deployRes = await fetch(`https://api.deno.com/v2/apps/${appId}/deploy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: 'Tradingbot market data relay',
      assets: {
        'main.ts': {
          kind: 'file',
          content: DENO_RELAY_CODE,
          encoding: 'utf-8',
        },
      },
      config: {
        install: 'deno install',
        runtime: {
          type: 'dynamic',
          entrypoint: 'main.ts',
        },
      },
    }),
  });
  if (!deployRes.ok) throw new Error(await readApiError(deployRes));
  const deployData = await deployRes.json() as Record<string, unknown>;
  logs.push('Deno accepted relay deployment');

  return {
    baseUrl: `https://${projectName}.${input.orgDomain}.deno.net`,
    deploymentId: String(deployData.id || deployData.deploymentId || appId) || null,
    logs,
    metadata: { appId, projectName, orgDomain: input.orgDomain },
  };
}
