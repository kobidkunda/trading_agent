export interface CalibrationBucket {
  bucket: string;
  range: string;
  count: number;
  predictedAvg: number;
  actualRate: number;
  brier: number;
}

export interface CategoryStats {
  count: number;
  brier: number;
  winRate: number;
  roi: number;
}

export interface ModelStats {
  count: number;
  brier: number;
  avgWeight: number;
}

export interface EnsemblePrediction {
  modelName: string;
  predictedProb: number;
  weight: number;
  actualOutcome: string;
}

export class BrierCalibrationEngine {
  static computeBrier(predictedProb: number, actualOutcome: string): number {
    const actual = actualOutcome === 'YES' ? 1 : 0;
    return Math.pow(predictedProb - actual, 2);
  }

  static computeRollingBrier(bets: { predictedProb: number; actualOutcome: string }[], window: number): number {
    const recent = bets.slice(-window);
    if (recent.length === 0) return 0;
    const sum = recent.reduce((acc, bet) => acc + this.computeBrier(bet.predictedProb, bet.actualOutcome), 0);
    return sum / recent.length;
  }

  static computeCalibrationBuckets(bets: Array<{ predictedProb: number; actualOutcome: string }>): CalibrationBucket[] {
    const buckets: CalibrationBucket[] = Array.from({ length: 10 }, (_, i) => ({
      bucket: i.toString(),
      range: `${(i * 0.1).toFixed(1)}-${((i + 1) * 0.1).toFixed(1)}`,
      count: 0,
      predictedAvg: 0,
      actualRate: 0,
      brier: 0,
    }));

    bets.forEach(bet => {
      const idx = Math.min(Math.floor(bet.predictedProb * 10), 9);
      const b = buckets[idx];
      b.count++;
      b.predictedAvg += bet.predictedProb;
      b.actualRate += (bet.actualOutcome === 'YES' ? 1 : 0);
      b.brier += this.computeBrier(bet.predictedProb, bet.actualOutcome);
    });

    return buckets.filter(b => b.count > 0).map(b => ({
      ...b,
      predictedAvg: b.predictedAvg / b.count,
      actualRate: b.actualRate / b.count,
      brier: b.brier / b.count
    }));
  }

  static computeByCategory(bets: Array<{ predictedProb: number; actualOutcome: string; category: string }>): Record<string, CategoryStats> {
    const stats: Record<string, CategoryStats> = {};
    bets.forEach(bet => {
      if (!stats[bet.category]) {
        stats[bet.category] = { count: 0, brier: 0, winRate: 0, roi: 0 };
      }
      const s = stats[bet.category];
      s.count++;
      s.brier += this.computeBrier(bet.predictedProb, bet.actualOutcome);
      if (bet.actualOutcome === 'YES') s.winRate++;
    });
    
    Object.keys(stats).forEach(c => {
      const s = stats[c];
      s.brier /= s.count;
      s.winRate /= s.count;
    });
    return stats;
  }

  static computeByModel(predictions: EnsemblePrediction[]): Record<string, ModelStats> {
    const stats: Record<string, ModelStats> = {};
    predictions.forEach(p => {
      if (!stats[p.modelName]) {
        stats[p.modelName] = { count: 0, brier: 0, avgWeight: 0 };
      }
      const s = stats[p.modelName];
      s.count++;
      s.brier += this.computeBrier(p.predictedProb, p.actualOutcome);
      s.avgWeight += p.weight;
    });
    
    Object.keys(stats).forEach(m => {
      const s = stats[m];
      s.brier /= s.count;
      s.avgWeight /= s.count;
    });
    return stats;
  }
}
