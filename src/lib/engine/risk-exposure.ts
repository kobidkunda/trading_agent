export interface PositionExposureInput {
  currentSize: number;
  market: {
    category: string;
  };
}

export function computeExposureTotals(positions: PositionExposureInput[], marketCategory: string) {
  let dailyExposure = 0;
  let categoryExposure = 0;

  for (const position of positions) {
    dailyExposure += Number(position.currentSize || 0);
    if (position.market.category === marketCategory) {
      categoryExposure += Number(position.currentSize || 0);
    }
  }

  return {
    dailyExposure,
    categoryExposure,
  };
}
