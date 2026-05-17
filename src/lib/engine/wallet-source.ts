export type WalletSourceMode = 'DISABLED' | 'IMPORT' | 'LIVE_CONNECTOR';

export interface WalletSourceHealth {
  mode: WalletSourceMode;
  healthy: boolean;
  trusted: boolean;
  sourceName: string;
  message?: string;
}

export interface WalletTradeImportRecord {
  address: string;
  externalMarketId: string;
  side: string;
  quantity: number;
  price: number;
  tradeTimestamp: string;
  category?: string;
  resolutionDate?: string;
  currentPosition?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
}

export interface WalletSourceAdapter {
  readonly mode: WalletSourceMode;
  readonly sourceName: string;
  readonly trusted: boolean;
  listKnownWallets(): Promise<string[]>;
  getWalletProfile(address: string): Promise<Record<string, unknown> | null>;
  getWalletTrades(address: string, cursor?: string | null): Promise<{ trades: WalletTradeImportRecord[]; nextCursor: string | null }>;
  getWalletPositions(address: string): Promise<Record<string, unknown>[]>;
  getWalletResolvedPnL(address: string): Promise<number | null>;
  getWalletOpenPnL(address: string): Promise<number | null>;
  getWalletActivitySince(timestamp: string): Promise<WalletTradeImportRecord[]>;
  healthCheck(): Promise<WalletSourceHealth>;
}

export const WALLET_SOURCE_SETTINGS_KEY = 'wallet_source_config';

export interface WalletSourceConfig {
  mode: WalletSourceMode;
  sourceName: string;
  trusted: boolean;
}

export const DEFAULT_WALLET_SOURCE_CONFIG: WalletSourceConfig = {
  mode: 'DISABLED',
  sourceName: 'disabled',
  trusted: false,
};

export function normalizeWalletSourceConfig(input: Partial<WalletSourceConfig> | null | undefined): WalletSourceConfig {
  const mode = input?.mode;
  const normalizedMode: WalletSourceMode =
    mode === 'IMPORT' || mode === 'LIVE_CONNECTOR' || mode === 'DISABLED'
      ? mode
      : 'DISABLED';

  return {
    mode: normalizedMode,
    sourceName: input?.sourceName?.trim() || normalizedMode.toLowerCase(),
    trusted: normalizedMode === 'LIVE_CONNECTOR' ? Boolean(input?.trusted) : false,
  };
}

export class DisabledWalletSourceAdapter implements WalletSourceAdapter {
  readonly mode: WalletSourceMode = 'DISABLED';
  readonly sourceName = 'disabled';
  readonly trusted = false;

  async listKnownWallets(): Promise<string[]> { return []; }
  async getWalletProfile(): Promise<Record<string, unknown> | null> { return null; }
  async getWalletTrades(): Promise<{ trades: WalletTradeImportRecord[]; nextCursor: string | null }> {
    return { trades: [], nextCursor: null };
  }
  async getWalletPositions(): Promise<Record<string, unknown>[]> { return []; }
  async getWalletResolvedPnL(): Promise<number | null> { return null; }
  async getWalletOpenPnL(): Promise<number | null> { return null; }
  async getWalletActivitySince(): Promise<WalletTradeImportRecord[]> { return []; }
  async healthCheck(): Promise<WalletSourceHealth> {
    return {
      mode: this.mode,
      healthy: true,
      trusted: this.trusted,
      sourceName: this.sourceName,
      message: 'Wallet source disabled',
    };
  }
}

export class ImportWalletSourceAdapter implements WalletSourceAdapter {
  readonly mode: WalletSourceMode = 'IMPORT';
  readonly sourceName = 'import';
  readonly trusted = false;

  async listKnownWallets(): Promise<string[]> { return []; }
  async getWalletProfile(): Promise<Record<string, unknown> | null> { return null; }
  async getWalletTrades(): Promise<{ trades: WalletTradeImportRecord[]; nextCursor: string | null }> {
    return { trades: [], nextCursor: null };
  }
  async getWalletPositions(): Promise<Record<string, unknown>[]> { return []; }
  async getWalletResolvedPnL(): Promise<number | null> { return null; }
  async getWalletOpenPnL(): Promise<number | null> { return null; }
  async getWalletActivitySince(): Promise<WalletTradeImportRecord[]> { return []; }
  async healthCheck(): Promise<WalletSourceHealth> {
    return {
      mode: this.mode,
      healthy: true,
      trusted: this.trusted,
      sourceName: this.sourceName,
      message: 'Wallet import mode ready',
    };
  }
}
