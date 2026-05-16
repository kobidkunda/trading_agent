import type { StageServiceMapping } from '@/lib/types';
import { getStageRouting } from '../service-routing';
import { getCredentialForService } from './search';

export interface AgentReachResult {
  provider: 'agent_reach';
  status: 'completed' | 'failed';
  summary: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
  error?: string;
  sourceCount?: number;
  channels?: string[];
}

interface AgentReachOptions {
  routing?: StageServiceMapping;
  targetSourceCount?: number; // Target: 500 sources
}

// MCP (Model Context Protocol) Types
interface MCPRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

function normalizeSources(input: unknown): Array<{ title: string; url: string; snippet: string }> {
  console.log('[Agent-Reach] Normalizing sources:', { type: typeof input, isArray: Array.isArray(input) });
  
  if (!Array.isArray(input)) {
    console.warn('[Agent-Reach] Expected array but got:', typeof input, input);
    return [];
  }

  const normalized = input
    .map((item, index) => {
      const source = item as Record<string, unknown>;
      const normalized = {
        title: String(source.title || source.name || ''),
        url: String(source.url || source.link || ''),
        snippet: String(source.snippet || source.content || source.description || ''),
      };
      
      if (!normalized.title && !normalized.url && !normalized.snippet) {
        console.warn(`[Agent-Reach] Source ${index} has no valid content:`, source);
      }
      
      return normalized;
    })
    .filter((source) => source.title || source.url || source.snippet);

  console.log(`[Agent-Reach] Normalized ${normalized.length} sources from ${input.length} input items`);
  return normalized;
}

function normalizeSummary(status: 'completed' | 'failed', summary: unknown): string {
  if (typeof summary === 'string' && summary.trim()) {
    return summary;
  }

  return status === 'failed' ? 'Agent Reach failed' : 'Agent Reach completed';
}

/**
 * MCP Client for Agent-Reach (Standard MCP Protocol)
 * Connects to MCP server at /mcp endpoint (direct JSON-RPC POST)
 */
async function callMCPMethod(
  baseUrl: string,
  method: string,
  params: Record<string, unknown>,
  apiKey?: string
): Promise<unknown> {
  const sessionId = `tradingbot_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const mcpEndpoint = `${baseUrl.replace(/\/$/, '')}/mcp`;
  
  console.log(`[Agent-Reach MCP] Calling tool: ${method}, session: ${sessionId}`);
  console.log(`[Agent-Reach MCP] Endpoint: ${mcpEndpoint}`);
  
  try {
    // Standard MCP tools/call protocol
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: sessionId,
      method: 'tools/call',
      params: {
        name: method,
        arguments: params,
      },
    };
    
    console.log('[Agent-Reach MCP] Sending tools/call:', JSON.stringify(request, null, 2));
    
    const response = await fetch(mcpEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120000),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Agent-Reach MCP] HTTP ${response.status}:`, errorText);
      throw new Error(`MCP request failed: HTTP ${response.status} - ${errorText}`);
    }
    
    // Parse response
    const responseData = await response.json() as MCPResponse;
    console.log('[Agent-Reach MCP] Response:', JSON.stringify(responseData, null, 2));
    
    if (responseData.error) {
      throw new Error(`MCP error ${responseData.error.code}: ${responseData.error.message}`);
    }
    
    // Extract content from tools/call response
    const result = responseData.result as Record<string, unknown>;
    if (result?.content && Array.isArray(result.content) && result.content.length > 0) {
      const firstContent = result.content[0] as Record<string, unknown>;
      const text = firstContent?.text;
      if (typeof text === 'string') {
        try {
          return JSON.parse(text);
        } catch {
          return { text };
        }
      }
    }
    
    return result;
  } catch (error) {
    console.error('[Agent-Reach MCP] Error:', error);
    throw error;
  }
}

/**
 * Legacy REST API fallback for Agent-Reach
 * Used when MCP is not available
 */
async function callRestAPI(
  baseUrl: string,
  query: string,
  toolName: string,
  apiKey?: string,
  targetCount?: number
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, '')}/mcp`;
  console.log(`[Agent-Reach REST] Calling MCP direct: ${url}`);
  console.log(`[Agent-Reach REST] Tool: ${toolName}, query: ${query}`);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `rest_${Date.now()}`,
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: {
            query,
            targetSourceCount: targetCount,
          },
        },
      }),
      signal: AbortSignal.timeout(120000),
    });

    console.log(`[Agent-Reach REST] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Agent-Reach REST] HTTP error ${response.status}:`, errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const result = data.result as Record<string, unknown>;
    if (result?.content && Array.isArray(result.content) && result.content.length > 0) {
      const firstContent = result.content[0] as Record<string, unknown>;
      const text = firstContent?.text;
      if (typeof text === 'string') {
        try {
          return JSON.parse(text);
        } catch {
          return { text };
        }
      }
    }
    return result;
  } catch (error) {
    console.error('[Agent-Reach REST] Error:', error);
    throw error;
  }
}

export async function runAgentReachResearch(
  query: string,
  options?: AgentReachOptions
): Promise<AgentReachResult | null> {
  const startTime = Date.now();
  console.log('[Agent-Reach] Starting research for query:', query);
  
  const routing = options?.routing || await getStageRouting();
  const targetSourceCount = options?.targetSourceCount || 500;

  if (routing.agentReachEnabled !== true) {
    console.log('[Agent-Reach] Disabled in routing settings');
    return null;
  }

  const cred = await getCredentialForService('agent-reach');
  const baseUrl = routing.agentReachServiceUrl || cred?.baseUrl || process.env.AGENT_REACH_URL;
  const toolName = routing.agentReachToolName || 'research';
  const credentialToolName = (cred as { toolName?: string } | null)?.toolName;

  console.log('[Agent-Reach] Configuration:', {
    baseUrl: baseUrl || 'NOT SET',
    toolName,
    targetSourceCount,
    enabled: routing.agentReachEnabled,
  });

  if (!baseUrl) {
    const error = 'Agent-Reach URL not configured';
    console.error('[Agent-Reach]', error);
    return {
      provider: 'agent_reach',
      status: 'failed',
      summary: error,
      sources: [],
      error,
    };
  }

  try {
    let data: unknown;
    
    // Try MCP protocol first
    try {
      console.log('[Agent-Reach] Attempting MCP protocol...');
      data = await callMCPMethod(
        baseUrl,
        credentialToolName || toolName,
        { 
          query,
          targetSourceCount,
        },
        cred?.apiKey
      );
      console.log('[Agent-Reach] MCP protocol succeeded');
    } catch (mcpError) {
      console.log('[Agent-Reach] MCP failed, falling back to REST API:', mcpError);
      // Fallback to REST API
      data = await callRestAPI(baseUrl, query, toolName, cred?.apiKey, targetSourceCount);
    }

    const result = data as Record<string, unknown>;
    const status = result?.status === 'failed' || result?.status === 'error' ? 'failed' : 'completed';
    const sources = normalizeSources(result?.sources);
    
    const duration = Date.now() - startTime;
    console.log(`[Agent-Reach] Research completed in ${duration}ms`);
    console.log(`[Agent-Reach] Status: ${status}, Sources: ${sources.length}/${targetSourceCount}`);
    
    if (status === 'failed' || sources.length < targetSourceCount * 0.5) {
      console.warn(`[Agent-Reach] Only got ${sources.length} sources (target: ${targetSourceCount})`);
    }

    return {
      provider: 'agent_reach',
      status,
      summary: normalizeSummary(status, result?.summary),
      sources,
      sourceCount: sources.length,
      channels: Array.isArray(result?.channels) ? result.channels : undefined,
      error: typeof result?.error === 'string' ? result.error : undefined,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown Agent-Reach error';
    const errorStack = error instanceof Error ? error.stack : '';
    
    console.error('[Agent-Reach] Research failed:', {
      duration,
      error: errorMessage,
      stack: errorStack,
      query,
    });
    
    return {
      provider: 'agent_reach',
      status: 'failed',
      summary: `Agent Reach failed: ${errorMessage}`,
      sources: [],
      error: errorMessage,
    };
  }
}

/**
 * Test Agent-Reach MCP connection
 */
export async function testAgentReachConnection(
  baseUrl: string,
  apiKey?: string
): Promise<{ ok: boolean; message: string; channels?: string[] }> {
  console.log('[Agent-Reach] Testing connection to:', baseUrl);
  
  try {
    const result = await callMCPMethod(baseUrl, 'get_status', {}, apiKey) as Record<string, unknown>;
    console.log('[Agent-Reach] Connection test result:', result);
    
    // Extract channels from get_status response (keyed by service name)
    const services = Object.keys(result).filter(k => k !== 'error');
    return {
      ok: true,
      message: `MCP connected: ${services.length} channels (${services.join(', ')})`,
      channels: services,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    console.error('[Agent-Reach] Connection test failed:', message);
    return {
      ok: false,
      message,
    };
  }
}
