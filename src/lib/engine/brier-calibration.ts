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

export interface BucketSufficiencyResult {
  buckets: CalibrationBucket[];
  sufficient: boolean;
  reason?: string;
}

export interface CategorySufficiencyResult {
  categories: Record<string, CategoryStats>;
  sufficient: boolean;
  reason?: string;
}

export interface SampleSufficiencyResult {
  sufficient: boolean;
  missingCategories: string[];
  totalsByCategory: Record<string, number>;
}

export class BrierCalibrationEngine {
  private static readonly MIN_SAMPLES_PER_BUCKET = 5;
  private static readonly MIN_SAMPLES_PER_CATEGORY = 10;
  private static readonly MIN_SAMPLES_ROLLING = 20;
  private static readonly MIN_PAPER_BETS_FOR_APLUS = 200;
  private static readonly MIN_BETS_PER_CATEGORY_EVAL = 50;
  private static readonly MIN_PREDICTIONS_PER_MODEL = 100;
  private static readonly MIN_WALLET_SIGNALS = 100;

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

  static computeCalibrationBuckets(bets: Array<{ predictedProb: number; actualOutcome: string }>): BucketSufficiencyResult {
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

    const populated = buckets.filter(b => b.count > 0).map(b => ({
      ...b,
      predictedAvg: b.predictedAvg / b.count,
      actualRate: b.actualRate / b.count,
      brier: b.brier / b.count
    }));

    const totalSamples = bets.length;
    if (totalSamples < this.MIN_SAMPLES_ROLLING) {
      return {
        buckets: populated,
        sufficient: false,
        reason: `Total samples (${totalSamples}) below minimum (${this.MIN_SAMPLES_ROLLING})`,
      };
    }

    const underpopulated = populated.filter(b => b.count < this.MIN_SAMPLES_PER_BUCKET);
    if (underpopulated.length > 0) {
      return {
        buckets: populated,
        sufficient: false,
        reason: `${underpopulated.length} bucket(s) below minimum ${this.MIN_SAMPLES_PER_BUCKET} samples`,
      };
    }

    return { buckets: populated, sufficient: true };
  }

  static computeByCategory(bets: Array<{ predictedProb: number; actualOutcome: string; category: string }>): CategorySufficiencyResult {
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

    const underpopulated = Object.entries(stats)
      .filter(([, s]) => s.count < this.MIN_SAMPLES_PER_CATEGORY)
      .map(([c]) => c);

    if (underpopulated.length > 0) {
      return {
        categories: stats,
        sufficient: false,
        reason: `Categories below minimum ${this.MIN_SAMPLES_PER_CATEGORY} samples: ${underpopulated.join(', ')}`,
      };
    }

    if (bets.length < this.MIN_BETS_PER_CATEGORY_EVAL) {
      return {
        categories: stats,
        sufficient: false,
        reason: `Total samples (${bets.length}) below evaluation minimum (${this.MIN_BETS_PER_CATEGORY_EVAL})`,
      };
    }

    return { categories: stats, sufficient: true };
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

  static computeSampleSufficiency(bets: Array<{ predictedProb: number; actualOutcome: string; category: string }>): SampleSufficiencyResult {
    const totalsByCategory: Record<string, number> = {};
    bets.forEach(bet => {
      totalsByCategory[bet.category] = (totalsByCategory[bet.category] || 0) + 1;
    });

    const missingCategories = Object.entries(totalsByCategory)
      .filter(([, count]) => count < this.MIN_SAMPLES_PER_CATEGORY)
      .map(([cat]) => cat);

    const sufficient = missingCategories.length === 0 && bets.length >= this.MIN_SAMPLES_ROLLING;

    return { sufficient, missingCategories, totalsByCategory };
  }
}
