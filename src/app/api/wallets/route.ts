import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { walletRanker } from '@/lib/engine/wallet-ranker';
import { walletClusterDetector } from '@/lib/engine/wallet-cluster';
import { computeWalletSignalScore } from '@/lib/engine/wallet-signal';

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
    const limit = Math.min(200, parseInt(searchParams.get('limit') || '50'));
    const offset = parseInt(searchParams.get('offset') || '0');

    if (showClusters) {
      const clusters = await walletClusterDetector.detectClusters();
      const recent = clusters.slice(0, limit);
      return NextResponse.json({ clusters: recent, total: clusters.length });
    }

    const where = await buildWhereClause(searchParams);
    const wallets = await db.wallet.findMany({
      where,
      orderBy: { rank: 'asc' },
      take: limit,
      skip: offset,
      include: { trades: { orderBy: { tradeTimestamp: 'desc' }, take: 5 } },
    });

    const total = await db.wallet.count({ where });

    const withRankings = wallets.map((w) => ({
      ...w,
      scoreComputed: w.rank !== null,
    }));

    return NextResponse.json({ wallets: withRankings, total, limit, offset });
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

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process wallet request' }, { status: 500 });
  }
}
