export type ResearchTier = 'NONE' | 'QUICK' | 'STANDARD' | 'DEEP';

export interface ResearchBudget {
  deepRemaining: number;
  standardRemaining: number;
  quickRemaining: number;
  maxDeepPerHour: number;
  maxStandardPerHour: number;
  resetAt: Date;
}

export interface DeepTierCapabilities {
  causalTree: boolean;
  deerflow: boolean;
  tradingagents: boolean;
  ensemblePipelines: boolean;
}

export class ResearchGate {
  private budget: ResearchBudget;

  constructor() {
    this.budget = {
      deepRemaining: 5,
      standardRemaining: 15,
      quickRemaining: 50,
      maxDeepPerHour: 5,
      maxStandardPerHour: 15,
      resetAt: new Date(Date.now() + 3600000),
    };
  }

  getResearchDepth(score: number): ResearchTier {
    if (score < 40) return 'NONE';
    if (score < 70) return 'QUICK';
    if (score < 85) return 'STANDARD';
    if (score < 90) return 'STANDARD';
    return 'DEEP';
  }

  getDeepTierCapabilities(): DeepTierCapabilities {
    return {
      causalTree: true,
      deerflow: true,
      tradingagents: true,
      ensemblePipelines: true,
    };
  }

  getResearchPath(depth: ResearchTier): string[] {
    if (depth === 'NONE') return [];
    if (depth === 'QUICK') return ['searxng_search', 'tradingagents_analysts', 'debate_arena'];
    if (depth === 'STANDARD') return ['searxng_search', 'tradingagents_analysts', 'debate_arena', 'mirofish_predict'];
    return ['searxng_search', 'tradingagents_analysts', 'causal_tree', 'ensemble_pipelines'];
  }

  canRunDeepResearch(): boolean {
    return this.budget.deepRemaining > 0;
  }

  recordResearchRun(depth: ResearchTier): void {
    if (depth === 'DEEP') this.budget.deepRemaining--;
    if (depth === 'STANDARD') this.budget.standardRemaining--;
    if (depth === 'QUICK') this.budget.quickRemaining--;
  }

  getBudgetStatus(): ResearchBudget {
    return { ...this.budget };
  }
}
