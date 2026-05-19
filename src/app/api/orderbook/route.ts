import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { orderbookEngine, type PriceLevel } from '@/lib/engine/orderbook-microstructure';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');
    const pagination = parsePaginationParams(searchParams);

    if (!marketId) {
      const [snapshots, total] = await Promise.all([
        db.orderbookSnapshot.findMany({
          orderBy: { capturedAt: 'desc' },
          skip: (pagination.page - 1) * pagination.limit,
          take: pagination.limit,
          include: {
            market: {
              select: {
                id: true,
                title: true,
                venue: true,
                category: true,
              },
            },
          },
        }),
        db.orderbookSnapshot.count(),
      ]);
      
      const mapped = snapshots.map(s => ({
        id: s.id,
        marketId: s.marketId,
        marketTitle: s.market?.title ?? '',
        venue: s.market?.venue ?? '',
        category: s.market?.category ?? '',
        bestBid: s.bestBid,
        bestAsk: s.bestAsk,
        spread: s.spread,
        bidDepth: s.bidDepth,
        askDepth: s.askDepth,
        depthImbalance: s.depthImbalance,
        largeBidWall: s.largeBidWall,
        largeAskWall: s.largeAskWall,
        thinBookDanger: s.thinBookDanger,
        thinBookWarning: s.thinBookDanger,
        priceImpact: s.priceImpact,
        fillProbability: s.fillProbability,
        capturedAt: s.capturedAt,
        lastUpdated: s.capturedAt,
      }));
      
      return NextResponse.json(buildPaginatedResponse(mapped, total, pagination));
    }

    const snapshot = await db.orderbookSnapshot.findFirst({
      where: { marketId },
      orderBy: { capturedAt: 'desc' },
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: 'No orderbook snapshot found for this market', marketId },
        { status: 404 },
      );
    }

    const levels: PriceLevel[] = snapshot.rawJson
      ? (() => {
          try {
            const parsed = JSON.parse(snapshot.rawJson);
            if (parsed.levels && Array.isArray(parsed.levels)) {
              return parsed.levels.map((l: { price: number; size: number; side?: 'BID' | 'ASK' }) => ({
                price: l.price,
                size: l.size,
                side: l.side,
              }));
            }
          } catch {
          }
          return [];
        })()
      : [];

    const analysis = orderbookEngine.analyze({
      bestBid: snapshot.bestBid,
      bestAsk: snapshot.bestAsk,
      spread: snapshot.spread ?? undefined,
      bidDepth: snapshot.bidDepth ?? undefined,
      askDepth: snapshot.askDepth ?? undefined,
      orderSize: 1000,
      levels: levels.length > 0 ? levels : undefined,
      recentMovement: snapshot.recentMovement ?? undefined,
      depthDecay: snapshot.depthDecay ?? undefined,
    });

    return NextResponse.json({
      snapshot: {
        id: snapshot.id,
        marketId: snapshot.marketId,
        bestBid: snapshot.bestBid,
        bestAsk: snapshot.bestAsk,
        spread: snapshot.spread,
        bidDepth: snapshot.bidDepth,
        askDepth: snapshot.askDepth,
        depthImbalance: snapshot.depthImbalance,
        largeBidWall: snapshot.largeBidWall,
        largeAskWall: snapshot.largeAskWall,
        thinBookDanger: snapshot.thinBookDanger,
        priceImpact: snapshot.priceImpact,
        fillProbability: snapshot.fillProbability,
        recentMovement: snapshot.recentMovement,
        depthDecay: snapshot.depthDecay,
        capturedAt: snapshot.capturedAt,
      },
      analysis,
    });
  } catch (error) {
    console.error('[Orderbook API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orderbook snapshot', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { marketId, bestBid, bestAsk, spread, bidDepth, askDepth, rawJson } = body;

    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    const market = await db.market.findUnique({ where: { id: marketId } });
    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    const levels: PriceLevel[] = rawJson
      ? (() => {
          try {
            const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
            if (parsed.levels && Array.isArray(parsed.levels)) {
              return parsed.levels.map((l: { price: number; size: number; side?: 'BID' | 'ASK' }) => ({
                price: l.price,
                size: l.size,
                side: l.side,
              }));
            }
          } catch {
          }
          return [];
        })()
      : [];

    const analysis = orderbookEngine.analyze({
      bestBid: bestBid ?? null,
      bestAsk: bestAsk ?? null,
      spread: spread ?? null,
      bidDepth: bidDepth ?? null,
      askDepth: askDepth ?? null,
      orderSize: 1000,
      levels: levels.length > 0 ? levels : null,
    });

    const rawJsonString = typeof rawJson === 'string' ? rawJson : rawJson ? JSON.stringify(rawJson) : null;

    const snapshot = await db.orderbookSnapshot.create({
      data: {
        marketId,
        bestBid: bestBid ?? null,
        bestAsk: bestAsk ?? null,
        spread: spread ?? null,
        bidDepth: bidDepth ?? null,
        askDepth: askDepth ?? null,
        depthImbalance: analysis.depthImbalance?.imbalance ?? null,
        largeBidWall: analysis.whaleWalls?.bidWalls[0]?.size ?? null,
        largeAskWall: analysis.whaleWalls?.askWalls[0]?.size ?? null,
        thinBookDanger: analysis.thinBookDanger,
        priceImpact: analysis.priceImpact,
        fillProbability: analysis.fillProbability,
        rawJson: rawJsonString,
      },
    });

    await db.market.update({
      where: { id: marketId },
      data: { lastSnapshotAt: new Date() },
    });

    return NextResponse.json(
      { snapshot: { id: snapshot.id, marketId: snapshot.marketId, capturedAt: snapshot.capturedAt }, analysis },
      { status: 201 },
    );
  } catch (error) {
    console.error('[Orderbook API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create orderbook snapshot', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
