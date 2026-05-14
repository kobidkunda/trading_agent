import { getCredentialForService } from './search';

export interface DeerFlowThreadResult {
  threadId: string;
  messages: Array<{ role: string; content: string }>;
  research: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
  status: string;
}

export async function fetchDeerFlowModels(): Promise<string[]> {
  try {
    const cred = await getCredentialForService('deerflow');
    if (!cred?.baseUrl) {
      return [];
    }

    const response = await fetch(`${cred.baseUrl.replace(/\/$/, '')}/api/models`, {
      headers: cred.apiKey ? { Authorization: `Bearer ${cred.apiKey}` } : {},
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data?.models)) {
      return [];
    }

    return data.models
      .map((model: { id?: string }) => model?.id)
      .filter((modelId: string | undefined): modelId is string => Boolean(modelId));
  } catch (error) {
    console.error('[DeerFlow API] fetchDeerFlowModels error:', error);
    return [];
  }
}

export async function runDeerFlowViaAPI(
  query: string,
  impliedProbability?: number,
  model?: string,
): Promise<DeerFlowThreadResult | null> {
  const cred = await getCredentialForService('deerflow');
  if (!cred?.baseUrl) {
    return null;
  }

  const baseUrl = cred.baseUrl.replace(/\/$/, '');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cred.apiKey) {
    headers['Authorization'] = `Bearer ${cred.apiKey}`;
  }

  try {
    const threadRes = await fetch(`${baseUrl}/api/threads`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ metadata: { source: 'trading-bot', type: 'deep-research' } }),
      signal: AbortSignal.timeout(15000),
    });

    if (!threadRes.ok) {
      console.error(`[DeerFlow API] Thread creation failed: ${threadRes.status}`);
      return null;
    }

    const thread = await threadRes.json();
    const threadId = thread.thread_id;
    if (!threadId) {
      console.error('[DeerFlow API] No thread_id in response');
      return null;
    }

    const prompt = impliedProbability
      ? `Deep research on: "${query}". Current implied probability: ${(impliedProbability * 100).toFixed(1)}%. Analyze whether this probability is accurate based on available evidence. Provide key findings, contradictions, and a confidence assessment.`
      : `Deep research on: "${query}". Provide key findings, contradictions, and a confidence assessment.`;

    const runRes = await fetch(`${baseUrl}/api/threads/${threadId}/runs/wait`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        assistant_id: 'deerflow',
        input: {
          messages: [{ role: 'user', content: prompt }],
        },
        config: {
          configurable: {
            thread_id: threadId,
            ...(model ? { model } : {}),
          },
        },
      }),
      signal: AbortSignal.timeout(300000),
    });

    if (!runRes.ok) {
      console.error(`[DeerFlow API] Run failed: ${runRes.status}`);
      return null;
    }

    const runResult = await runRes.json();

    const messages = runResult?.values?.messages || runResult?.values || [];
    let research = '';
    const sources: Array<{ title: string; url: string; snippet: string }> = [];

    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg.role === 'assistant' || msg.type === 'ai') {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          research += content + '\n\n';
        }
      }
    }

    const stateRes = await fetch(`${baseUrl}/api/threads/${threadId}/state`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    let status = 'completed';
    if (stateRes.ok) {
      const state = await stateRes.json();
      status = state?.status || 'completed';
      const stateMessages = state?.values?.messages || [];
      if (!research && Array.isArray(stateMessages)) {
        for (const msg of stateMessages) {
          if (msg.role === 'assistant' || msg.type === 'ai') {
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            research += content + '\n\n';
          }
        }
      }
    }

    return {
      threadId,
      messages: Array.isArray(messages) ? messages : [],
      research: research.trim(),
      sources,
      status,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DeerFlow API] Error in runDeerFlowViaAPI:', errorMessage);
    // Log full error details for debugging
    if (error instanceof Error && error.cause) {
      console.error('[DeerFlow API] Error cause:', error.cause);
    }
    return null;
  }
}

export async function testDeerFlowConnection(baseUrl: string, apiKey?: string): Promise<{ ok: boolean; message: string }> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, message: `Connected to ${data.service || 'DeerFlow'}` };
    }
    return { ok: false, message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}