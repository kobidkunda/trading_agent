import type { QdrantDefaultCollectionDef, APlusSignalConfig } from '@/lib/types';

export const VENUE_OPTIONS = [
  { value: 'POLYMARKET', label: 'Polymarket', color: '#1a73e8' },
  { value: 'KALSHI', label: 'Kalshi', color: '#6c5ce7' },
  { value: 'SX_BET', label: 'SX Bet', color: '#00b894' },
  { value: 'MANIFOLD', label: 'Manifold', color: '#e17055' },
] as const;

export const RESEARCH_PROVIDER_OPTIONS = [
  { value: 'researchProvider', label: 'Research Provider', color: '#8b5cf6' },
] as const;

export const MIROFISH_BASE_URL = process.env.MIROFISH_BASE_URL || '';
export const MIROFISH_DEFAULT_MODEL = 'free_ling';
export const FIRECRAWL_SERVICE = 'Firecrawl';

export const CATEGORY_OPTIONS = [
  'politics',
  'sports',
  'crypto',
  'science',
  'entertainment',
  'economics',
  'technology',
  'health',
  'weather',
  'other',
] as const;

export const STAGE_COLORS: Record<string, string> = {
  SCANNED: 'bg-gray-500',
  TRIAGED: 'bg-blue-500',
  RESEARCHING: 'bg-yellow-500',
  DEERFLOW: 'bg-indigo-500',
  ANALYSTS: 'bg-rose-500',
  SYNTHESIS: 'bg-teal-500',
  JUDGED: 'bg-purple-500',
  DECIDED: 'bg-orange-500',
  EXECUTED: 'bg-green-500',
  SETTLED: 'bg-emerald-700',
};

export const DECISION_COLORS: Record<string, string> = {
  BID: 'text-emerald-400',
  WATCH: 'text-amber-400',
  SKIP: 'text-red-400',
};

export const REASON_CODE_DESCRIPTIONS: Record<string, string> = {
  LOW_LIQUIDITY: 'Market does not have sufficient liquidity to execute safely',
  WIDE_SPREAD: 'Bid-ask spread exceeds maximum allowed threshold',
  LOW_EDGE: 'Expected edge is insufficient after accounting for costs',
  MODERATE_EDGE: 'Edge exists but is moderate — worth monitoring for improvement',
  INSUFFICIENT_EDGE: 'Edge too thin with current confidence level',
  LOW_CONFIDENCE: 'Debate arena confidence is below minimum threshold',
  HIGH_UNCERTAINTY: 'Uncertainty in probability estimate is too high',
  CATALYST_TOO_CLOSE: 'Major catalyst event is imminent, avoiding new positions',
  CATEGORY_DISABLED: 'This market category is disabled in strategy settings',
  DAILY_LIMIT_REACHED: 'Maximum daily exposure limit has been reached',
  CORRELATED_RISK: 'Too much correlation with existing open positions',
  CLUSTER_EXPOSURE_EXCEEDED: 'Exposure in a correlation cluster exceeds the configured limit',
  TAIL_RISK_HIGH: 'Single position loss could wipe out multiple winning positions',
  CORRELATION_CLUSTER_OVERLAP: 'Market belongs to too many overlapping risk clusters',
  RESOLUTION_TOO_FAR: 'Market resolution is outside the configured trading window',
  MANUAL_REVIEW_REQUIRED: 'Edge case detected, requires human review',
};

export const DEFAULT_PROMPT_TEMPLATES = {
  triage: `You are a market triage agent for a prediction market trading system. Analyze the following market and classify it.

Market: {{market_title}}
Description: {{market_description}}
Category: {{category}}
Liquidity: {{liquidity}}
Implied Probability: {{implied_probability}}

Respond in JSON format:
{
  "status": "RELEVANT" | "IRRELEVANT" | "AMBIGUOUS",
  "reason": "One-line explanation",
  "worthResearch": true/false,
  "score": <0-100 integer — 0 = no value, 100 = high-value tradeable opportunity>
}`,

  bull: `You are the BULL case advocate. Make the strongest possible argument FOR this prediction market outcome.

Market: {{market_title}}
Current Implied Probability: {{implied_probability}}

Based on the research provided, construct the best bullish case. Consider favorable data, positive trends, and supporting evidence.

Respond in JSON:
{
  "thesis": "Bull thesis summary",
  "keyArguments": ["arg1", "arg2", ...],
  "supportingEvidence": ["evidence1", ...],
  "estimatedProbability": 0.XX,
  "confidence": 0.XX
}`,

  bear: `You are the BEAR case advocate. Make the strongest possible argument AGAINST this prediction market outcome.

Market: {{market_title}}
Current Implied Probability: {{implied_probability}}

Based on the research provided, construct the best bearish case. Consider risks, counterarguments, and negative indicators.

Respond in JSON:
{
  "thesis": "Bear thesis summary",
  "keyArguments": ["arg1", "arg2", ...],
  "supportingEvidence": ["evidence1", ...],
  "estimatedProbability": 0.XX,
  "confidence": 0.XX
}`,

  contradiction: `You are a contradiction agent. Search specifically for evidence that CONTRADICTS the prevailing analysis.

Market: {{market_title}}
Bull Case: {{bull_thesis}}
Bear Case: {{bear_thesis}}

Find disconfirming evidence, overlooked risks, and alternative interpretations.

Respond in JSON:
{
  "contradictions": ["contradiction1", ...],
  "overlookedRisks": ["risk1", ...],
  "alternativeInterpretations": ["alt1", ...],
  "reliabilityAssessment": 0.XX
}`,

  judge: `You are the JUDGE - the final arbiter. Synthesize the bull, bear, and contradiction arguments into a single structured estimate.

Market: {{market_title}}
Current Implied Probability: {{implied_probability}}
Bull Case: {{bull_output}}
Bear Case: {{bear_output}}
Contradictions: {{contradiction_output}}

Respond in STRICT JSON:
{
  "trueProbability": 0.XX,
  "confidence": 0.XX,
  "uncertainty": 0.XX,
  "uncertaintyPenalty": 0.XX,
  "proEvidence": ["evidence1", ...],
  "antiEvidence": ["evidence1", ...],
  "sourceQuality": 0.XX,
  "freshness": 0.XX,
  "catalystTiming": "NONE|CLOSE|FAR",
  "skipReason": null or "reason if skipping"
}`,

  postmortem: `You are a postmortem analyst. Review the outcome of a completed trade and extract lessons.

Market: {{market_title}}
Predicted Probability: {{predicted_probability}}
Actual Outcome: {{actual_outcome}}
PnL: {{pnl}}
Bull Case: {{bull_output}}
Bear Case: {{bear_output}}
Judge Output: {{judge_output}}

Analyze:
1. What went right/wrong
2. Was the probability estimate accurate?
3. Were there missed signals?
4. What patterns should be remembered?

Respond in JSON:
{
  "summary": "Postmortem summary",
  "accuracyAssessment": "ACCURATE|OVERCONFIDENT|UNDERCONFIDENT|MISSED_SIGNALS",
  "lessons": ["lesson1", ...],
  "failureTags": ["tag1", ...],
  "recommendation": "What to do differently next time"
}`,
};

export const QDRANT_DEFAULT_COLLECTIONS: QdrantDefaultCollectionDef[] = [
  {
    key: 'researchMemory',
    defaultName: 'research_memory',
    description: 'Research run outputs, agent analysis, RAG retrieval',
    payloadIndexes: ['marketId', 'role', 'depth', 'createdAt'],
  },
  {
    key: 'marketSearch',
    defaultName: 'market_search',
    description: 'Market title/description embeddings for semantic search',
    payloadIndexes: ['venue', 'category', 'status', 'createdAt'],
  },
  {
    key: 'tradeHistory',
    defaultName: 'trade_history',
    description: 'Trade decision embeddings for pattern matching',
    payloadIndexes: ['marketId', 'action', 'side', 'outcome', 'createdAt'],
  },
];

export const EMBEDDING_PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI', defaultDims: 1536, description: 'text-embedding-3-small (1536 dims)' },
  { value: 'ollama', label: 'Ollama', defaultDims: 768, description: 'nomic-embed-text (768 dims)' },
  { value: 'custom', label: 'Custom', defaultDims: 0, description: 'Enter vector dimensions manually' },
] as const;

export const DEFAULT_APLUS_CONFIG: APlusSignalConfig = {
  minCandidateScore: 90,
  minAdjustedEdge: 0.07,
  minConfidence: 0.75,
  minResolutionClarity: 0.85,
  maxSpread: 0.03,
  minLiquidityByCategory: {
    crypto: 50000,
    politics: 20000,
    sports: 10000,
  },
  maxModelDisagreement: 0.15,
  maxTailRisk: 0.1,
  maxOracleRisk: 0.2,
  maxCorrelationExposure: 0.3,
  maxOrderbookAgeSeconds: 300,
};

export const DEFAULT_SCAN_CONFIG = {
  maxPagesPerVenue: {
    POLYMARKET: 10,
    KALSHI: 5,
    SX_BET: 5,
    MANIFOLD: 5,
  },
  scanTimeout: 300000,
  rateLimitDelay: 500,
  defaultScanMode: 'FULL_SCAN',
} as const;
