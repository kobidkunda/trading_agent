// Venue types
export type Venue = 'POLYMARKET' | 'KALSHI' | 'SX_BET' | 'MANIFOLD';

// Market status
export type MarketStatus = 'ACTIVE' | 'CLOSED' | 'RESOLVED';

// Candidate pipeline stages
export type CandidateStage = 'SCANNED' | 'TRIAGED' | 'RESEARCHING' | 'JUDGED' | 'DECIDED' | 'EXECUTED' | 'SETTLED';

// Triage status
export type TriageStatus = 'RELEVANT' | 'IRRELEVANT' | 'AMBIGUOUS';

// Decision action
export type DecisionAction = 'BUY' | 'SKIP';

// Order side
export type OrderSide = 'YES' | 'NO';

// Research depth
export type ResearchDepth = 'QUICK' | 'DEEP' | 'DEERFLOW';

// Risk reason codes enum
export type RiskReasonCode =
  | 'LOW_LIQUIDITY'
  | 'WIDE_SPREAD'
  | 'LOW_EDGE'
  | 'LOW_CONFIDENCE'
  | 'HIGH_UNCERTAINTY'
  | 'CATALYST_TOO_CLOSE'
  | 'CATEGORY_DISABLED'
  | 'DAILY_LIMIT_REACHED'
  | 'CORRELATED_RISK'
  | 'MANUAL_REVIEW_REQUIRED';

// Agent roles
export type AgentRole = 'TRIAGE' | 'BULL' | 'BEAR' | 'CONTRADICTION' | 'JUDGE';

// Research status
export type ResearchStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

// Job type
export type JobType = 'SCAN' | 'TRIAGE' | 'RESEARCH' | 'JUDGE' | 'RISK' | 'EXECUTE' | 'SETTLE';

// Job status
export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'RETRYING';

// Prompt template state
export type PromptState = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

// Strategy settings interface
export interface StrategySettings {
  enabledVenues: Venue[];
  enabledCategories: string[];
  minLiquidity: number;
  targetEdge: number;
  maxSpread: number;
  maxExposurePerMarket: number;
  maxDailyExposure: number;
  maxCategoryExposure: number;
  researchEscalationThreshold: number;
  dryRun: boolean;
  promptVersion: Record<string, number>; // prompt name -> version number
}

// Risk engine input
export interface RiskEngineInput {
  impliedProbability: number;
  judgeProbability: number;
  confidence: number;
  uncertainty: number;
  fees: number;
  slippage: number;
  venue: Venue;
  category: string;
  dailyExposure: number;
  categoryExposure: number;
  openPositions: number;
  marketLiquidity: number;
  marketSpread: number;
  catalystTiming?: string;
}

// Risk engine output
export interface RiskEngineOutput {
  action: DecisionAction;
  side?: OrderSide;
  maxSize: number;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE';
  reasonCode?: RiskReasonCode;
  reason: string;
  edge: number;
  adjustedSize: number;
  fees: number;
  slippage: number;
}

// Judge structured output
export interface JudgeOutput {
  trueProbability: number;
  confidence: number;
  uncertainty: number;
  uncertaintyPenalty: number;
  proEvidence: string[];
  antiEvidence: string[];
  sourceQuality: number;
  freshness: number;
  catalystTiming: string;
  skipReason?: string;
}

// System health metrics
export interface SystemHealth {
  queueDepth: number;
  failingJobs: number;
  apiHealth: Record<string, 'UP' | 'DOWN' | 'DEGRADED'>;
  venueRateLimits: Record<string, { remaining: number; resetAt: string }>;
  walletSync: 'OK' | 'ERROR' | 'SYNCING';
  dbStatus: 'UP' | 'DOWN';
  vectorStatus: 'UP' | 'DOWN';
  lastScanAt: string | null;
  uptimeSeconds: number;
}
