import { db } from '@/lib/db';
import type {
  WalletSourceAdapter,
  WalletSourceHealth,
  WalletSourceMode,
  WalletTradeImportRecord,
} from '@/lib/engine/wallet-source';

export const POLYMARKET_CLOB_URL = 'https://clob.polymarket.com';
export const POLYMARKET_GAMMA_URL = 'https://gamma-api.polymarket.com';
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Live Polymarket wallet source adapter.
 *
 * Connects to Polymarket's Gamma Markets API (GraphQL) to fetch real wallet
 * trades, positions, and PnL for tracked addresses.
 *
 * Current status: stub implementation with TODO comments showing the exact
 * GraphQL queries needed for full integration. The health check performs a
 * real connectivity test against the CLOB API.
 */
export class PolymarketWalletSourceAdapter implements WalletSourceAdapter {
  readonly mode: WalletSourceMode = 'LIVE_CONNECTOR';
  readonly sourceName = 'polymarket';
  readonly trusted = true;

  private apiKey: string;
  private addresses: string[];
  private _scanIntervalMs: number;

  constructor(config: {
    apiKey?: string;
    addresses?: string[];
    scanIntervalMs?: number;
  }) {
    this.apiKey = config.apiKey ?? '';
    this.addresses = config.addresses ?? [];
    this._scanIntervalMs = config.scanIntervalMs ?? 300_000;
    void this.apiKey; // consumed by GraphQL fetch once stubs become real
  }

  get scanIntervalMs(): number {
    return this._scanIntervalMs;
  }

  /** Tracked wallet addresses. Use setAddresses() to reconfigure at runtime. */
  get trackedAddresses(): string[] {
    return [...this.addresses];
  }

  setAddresses(addresses: string[]): void {
    this.addresses = [...addresses];
  }

  // ── WalletSourceAdapter implementation ──────────────────────────────────

  async listKnownWallets(): Promise<string[]> {
    return this.addresses;
  }

  async getWalletProfile(address: string): Promise<Record<string, unknown> | null> {
    return { address, venue: 'POLYMARKET' };
  }

  /**
   * Fetch wallet trades from Polymarket Gamma Markets API.
   *
   * TODO: Implement full GraphQL integration when API credentials configured.
   * See inline comment for the exact query format.
   */
  async getWalletTrades(
    address: string,
    _cursor?: string | null,
  ): Promise<{ trades: WalletTradeImportRecord[]; nextCursor: string | null }> {
    /*
     * ── Polymarket Gamma Markets API — GraphQL query ─────────────────────
     *
     * Endpoint: POST https://gamma-api.polymarket.com/query
     * Headers:
     *   Content-Type: application/json
     *   Authorization: Bearer $POLYMARKET_API_KEY
     *
     * Query:
     * ```graphql
     * query GetWalletTrades($address: String!, $first: Int!, $skip: Int!) {
     *   trades(
     *     where: { user: $address },
     *     first: $first,
     *     skip: $skip,
     *     orderBy: timestamp,
     *     orderDirection: desc
     *   ) {
     *     id
     *     conditionId
     *     outcomeIndex
     *     side          # BUY or SELL
     *     size
     *     price
     *     timestamp
     *     market {
     *       id
     *       question
     *       conditionId
     *       outcomes
     *       endDate
     *     }
     *   }
     * }
     * ```
     *
     * Implementation pattern (follows venues/polymarket.ts):
     *
     *   const resp = await fetch(`${POLYMARKET_GAMMA_URL}/query`, {
     *     method: 'POST',
     *     cache: 'no-store',
     *     headers: {
     *       'Content-Type': 'application/json',
     *       Authorization: `Bearer ${this.apiKey}`,
     *     },
     *     body: JSON.stringify({
     *       query: `...graphql query...`,
     *       variables: { address, first: 100, skip: cursor ?? 0 },
     *     }),
     *     signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
     *   });
     *
     * Mapping externalMarketId → Market.id:
     *   const conditionIds = trades.map(t => t.conditionId);
     *   const markets = await db.market.findMany({
     *     where: { venue: 'POLYMARKET', externalId: { in: conditionIds } },
     *     select: { id: true, externalId: true },
     *   });
     *   const idMap = new Map(markets.map(m => [m.externalId, m.id]));
     *
     * Each trade maps to WalletTradeImportRecord:
     *   externalMarketId = trade.conditionId
     *   side             = trade.side
     *   quantity         = trade.size
     *   price            = trade.price
     *   tradeTimestamp   = new Date(trade.timestamp).toISOString()
     *   category         = mapMarketCategory(trade.market)
     *   resolutionDate   = trade.market?.endDate ?? null
     *
     * Pagination:
     *   nextCursor = (trades.length === first) ? String(skip + first) : null
     */

    console.warn(
      `[PolymarketWalletSource] getWalletTrades(${address}): stub — Gamma API integration pending`,
    );
    return { trades: [], nextCursor: null };
  }

  /**
   * Fetch current wallet positions from Polymarket Gamma API.
   *
   * TODO: Implement full GraphQL integration.
   */
  async getWalletPositions(address: string): Promise<Record<string, unknown>[]> {
    /*
     * ── Polymarket Gamma Markets API — positions query ───────────────────
     *
     * Endpoint: POST https://gamma-api.polymarket.com/query
     * Headers: Authorization: Bearer $POLYMARKET_API_KEY
     *
     * ```graphql
     * query GetPositions($address: String!) {
     *   positions(where: { user: $address }) {
     *     id
     *     conditionId
     *     outcomeIndex
     *     quantity
     *     avgPrice
     *     currentPrice
     *     realizedPnl
     *     unrealizedPnl
     *     market {
     *       id
     *       question
     *       conditionId
     *       endDate
     *     }
     *   }
     * }
     * ```
     */

    console.warn(
      `[PolymarketWalletSource] getWalletPositions(${address}): stub — Gamma API integration pending`,
    );
    return [];
  }

  async getWalletResolvedPnL(address: string): Promise<number | null> {
    // TODO: Aggregate resolved PnL from Gamma portfolio endpoint.
    console.warn(
      `[PolymarketWalletSource] getWalletResolvedPnL(${address}): stub — Gamma API integration pending`,
    );
    return null;
  }

  async getWalletOpenPnL(address: string): Promise<number | null> {
    // TODO: Aggregate open PnL from Gamma positions endpoint.
    console.warn(
      `[PolymarketWalletSource] getWalletOpenPnL(${address}): stub — Gamma API integration pending`,
    );
    return null;
  }

  async getWalletActivitySince(_timestamp: string): Promise<WalletTradeImportRecord[]> {
    // TODO: Filter trades by timestamp via Gamma API.
    console.warn(
      `[PolymarketWalletSource] getWalletActivitySince: stub — API integration pending`,
    );
    return [];
  }

  /**
   * Health check — makes a real HTTP request to Polymarket CLOB API
   * to verify connectivity. Does not require an API key.
   */
  async healthCheck(): Promise<WalletSourceHealth> {
    try {
      const response = await fetch(
        `${POLYMARKET_CLOB_URL}/markets?limit=1&active=true`,
        {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        },
      );

      return {
        mode: this.mode,
        healthy: response.ok,
        trusted: this.trusted,
        sourceName: this.sourceName,
        message: response.ok
          ? `Polymarket CLOB API reachable (${this.addresses.length} wallets tracked)`
          : `Polymarket API returned HTTP ${response.status}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        mode: this.mode,
        healthy: false,
        trusted: this.trusted,
        sourceName: this.sourceName,
        message: `Connection failed: ${msg}`,
      };
    }
  }
}

/**
 * Build a PolymarketWalletSourceAdapter from config.
 *
 * Resolves API key from three sources (in priority order):
 *   1. Explicit config.apiKey
 *   2. POLYMARKET_API_KEY environment variable
 *   3. Credential store (db.credential with name 'POLYMARKET_API_KEY')
 */
export async function createPolymarketWalletSource(
  config: {
    apiKey?: string;
    addresses?: string[];
    scanIntervalMs?: number;
  } = {},
): Promise<PolymarketWalletSourceAdapter> {
  let apiKey = config.apiKey ?? process.env.POLYMARKET_API_KEY ?? '';

  // Fallback: credential store lookup (encrypted, needs crypto.ts decryption for prod)
  if (!apiKey) {
    try {
      const cred = await db.credential.findFirst({
        where: { service: 'polymarket', isActive: true },
      });
      if (cred) {
        // encryptedData requires AES-256-GCM decryption via crypto.ts
        // For now, adapter starts in stub mode; full integration decrypts here
      }
    } catch {
      // Credential store unavailable — proceed without key (stub/degraded mode)
    }
  }

  return new PolymarketWalletSourceAdapter({
    apiKey,
    addresses: config.addresses ?? [],
    scanIntervalMs: config.scanIntervalMs ?? 300_000,
  });
}
