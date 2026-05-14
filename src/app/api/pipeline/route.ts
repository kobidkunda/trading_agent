import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runPipelineForMarket } from '@/lib/engine/pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { marketId, marketTitle, venue, category, description, impliedProb, liquidity, spread } = body;

    let targetMarketId = marketId;

    if (!targetMarketId && marketTitle) {
      let market = await db.market.findFirst({
        where: { title: { contains: marketTitle } },
        include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
      });

      if (!market) {
        market = await db.market.create({
          data: {
            externalId: `pipeline_${Date.now()}`,
            venue: venue || 'POLYMARKET',
            title: marketTitle,
            description: description || '',
            category: category || 'other',
            status: 'ACTIVE',
          },
          include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
        });

        await db.marketSnapshot.create({
          data: {
            marketId: market.id,
            impliedProb: impliedProb ?? 0.5,
            liquidity: liquidity ?? 50000,
            spread: spread ?? 0.03,
            volume24h: 10000,
            bestBid: (impliedProb ?? 0.5) - 0.015,
            bestAsk: (impliedProb ?? 0.5) + 0.015,
          },
        });

        const existingCandidate = await db.tradeCandidate.findFirst({ where: { marketId: market.id } });
        if (!existingCandidate) {
          await db.tradeCandidate.create({
            data: { marketId: market.id, stage: 'SCANNED' },
          });
        }
      }

      targetMarketId = market.id;
    }

    if (!targetMarketId) {
      return NextResponse.json({ error: 'marketId or marketTitle required' }, { status: 400 });
    }

    const result = await runPipelineForMarket(targetMarketId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pipeline failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}