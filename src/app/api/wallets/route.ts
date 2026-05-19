import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { walletRanker } from '@/lib/engine/wallet-ranker';
import { walletClusterDetector } from '@/lib/engine/wallet-cluster';
import { computeWalletSignalScore } from '@/lib/engine/wallet-signal';
import { walletIngestion } from '@/lib/engine/wallet-ingestion';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';
import {
  DEFAULT_WALLET_SOURCE_CONFIG,
  ImportWalletSourceAdapter,
  normalizeWalletSourceConfig,
  WALLET_SOURCE_SETTINGS_KEY,
} from '@/lib/engine/wallet-source';

async function buildWhereClause(params: URLSearchParams): Promise<Prisma.WalletWhereInput> {
  const minTrades = parseInt(params.get('minTrades') || '0');
  const minWinRate = parseFloat(params.get('minWinRate') || '0');
  const where: Prisma.WalletWhereInput = { isActive: true };

  if (minTrades > 0) {
    where.totalTrades = { gte: minTrades };
  }
  if (minWinRate > 0) {
    where.winRate = { gte: minWinRate };
  }

  return where;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const showClusters = searchParams.get('clusters') === 'true';
    const pagination = parsePaginationParams(searchParams);

    if (showClusters) {
      const clusters = await walletClusterDetector.detectClusters();
      const recent = clusters.slice(0, pagination.limit);
      const walletSourceSetting = await db.settings.findUnique({ where: { key: WALLET_SOURCE_SETTINGS_KEY } });
      const walletSource = walletSourceSetting?.value
        ? normalizeWalletSourceConfig(JSON.parse(walletSourceSetting.value) as Record<string, unknown>)
        : DEFAULT_WALLET_SOURCE_CONFIG;
      return NextResponse.json({ clusters: recent, total: clusters.length, walletSource });
    }

    const where = await buildWhereClause(searchParams);
    const [wallets, total, clustersResult] = await Promise.all([
      db.wallet.findMany({
        where,
        orderBy: { rank: 'asc' },
        take: pagination.limit,
        skip: (pagination.page - 1) * pagination.limit,
        include: { trades: { orderBy: { tradeTimestamp: 'desc' }, take: 5 } },
      }),
      db.wallet.count({ where }),
      walletClusterDetector.detectClusters(),
    ]);
    const walletSourceSetting = await db.settings.findUnique({ where: { key: WALLET_SOURCE_SETTINGS_KEY } });
    const walletSource = walletSourceSetting?.value
      ? normalizeWalletSourceConfig(JSON.parse(walletSourceSetting.value) as Record<string, unknown>)
      : DEFAULT_WALLET_SOURCE_CONFIG;

    const withRankings = wallets.map((w) => ({
      ...w,
      scoreComputed: w.rank !== null,
    }));

    const profitableCount = wallets.filter((w) => w.realizedPnl > 0).length;
    const avgWinRate = wallets.length > 0
      ? wallets.reduce((s, w) => s + (w.winRate ?? 0), 0) / wallets.length
      : 0;

    return NextResponse.json({
      ...buildPaginatedResponse(withRankings, total, pagination),
      walletSource,
      clusters: clustersResult.slice(0, 10),
      totalWallets: total,
      profitableCount,
      avgWinRate,
      activeClusters: clustersResult.length,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch wallets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'rank';

    if (action === 'rank') {
      await walletRanker.updateRankings();
      const topWallets = await walletRanker.getTopWallets(50);
      return NextResponse.json({ success: true, ranked: topWallets.length });
    }

    if (action === 'signal') {
      const marketId = body.marketId;
      if (!marketId) {
        return NextResponse.json({ error: 'marketId required for signal action' }, { status: 400 });
      }
      const score = await computeWalletSignalScore(marketId);
      return NextResponse.json({ marketId, walletSignalScore: score });
    }

    if (action === 'configure-source') {
      const config = normalizeWalletSourceConfig(body);
      await db.settings.upsert({
        where: { key: WALLET_SOURCE_SETTINGS_KEY },
        update: { value: JSON.stringify(config), updatedAt: new Date() },
        create: {
          key: WALLET_SOURCE_SETTINGS_KEY,
          value: JSON.stringify(config),
          description: 'Wallet source mode and trust settings',
        },
      });
      return NextResponse.json({ success: true, walletSource: config });
    }

    if (action === 'import') {
      const payload = Array.isArray(body.wallets) ? body.wallets : [];
      if (payload.length === 0) {
        return NextResponse.json({ error: 'wallets array is required for import action' }, { status: 400 });
      }

      const adapter = new ImportWalletSourceAdapter();
      const result = await walletIngestion.ingestWallets(payload, body.venue || 'POLYMARKET', {
        sourceMode: adapter.mode,
        sourceName: body.sourceName || adapter.sourceName,
        trustedSource: false,
      });

      const config = normalizeWalletSourceConfig({
        mode: 'IMPORT',
        sourceName: body.sourceName || adapter.sourceName,
        trusted: false,
      });
      await db.settings.upsert({
        where: { key: WALLET_SOURCE_SETTINGS_KEY },
        update: { value: JSON.stringify(config), updatedAt: new Date() },
        create: {
          key: WALLET_SOURCE_SETTINGS_KEY,
          value: JSON.stringify(config),
          description: 'Wallet source mode and trust settings',
        },
      });

      return NextResponse.json({
        success: true,
        walletSource: config,
        importResult: result,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process wallet request' }, { status: 500 });
  }
}
