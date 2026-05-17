import { NextRequest, NextResponse } from 'next/server';
import { computeBiasAdjustedProb } from '@/lib/engine/bias-correction';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketPrice = searchParams.get('marketPrice');
    const category = searchParams.get('category');
    const timeToResolution = searchParams.get('timeToResolution');
    const liquidity = searchParams.get('liquidity');
    const contractType = searchParams.get('contractType');

    if (!marketPrice) {
      return NextResponse.json({ error: 'marketPrice query parameter is required' }, { status: 400 });
    }
    if (!category) {
      return NextResponse.json({ error: 'category query parameter is required' }, { status: 400 });
    }

    const price = parseFloat(marketPrice);
    if (isNaN(price) || price < 0 || price > 1) {
      return NextResponse.json({ error: 'marketPrice must be a number between 0 and 1' }, { status: 400 });
    }

    const ttr = timeToResolution ? parseFloat(timeToResolution) : 30;
    if (isNaN(ttr) || ttr < 0) {
      return NextResponse.json({ error: 'timeToResolution must be a non-negative number' }, { status: 400 });
    }

    const liq = liquidity ? parseFloat(liquidity) : 5000;
    if (isNaN(liq) || liq < 0) {
      return NextResponse.json({ error: 'liquidity must be a non-negative number' }, { status: 400 });
    }

    const result = computeBiasAdjustedProb({
      marketPrice: price,
      category,
      timeToResolution: ttr,
      liquidity: liq,
      contractType: contractType ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to compute bias correction', details: String(error) },
      { status: 500 },
    );
  }
}
