// Venue types
export type Venue = 'POLYMARKET' | 'KALSHI' | 'SX_BET' | 'MANIFOLD';

// Market status
export type MarketStatus = 'ACTIVE' | 'CLOSED' | 'RESOLVED';

// Candidate pipeline stages
export type CandidateStage = 'SCANNED' | 'TRIAGED' | 'RESEARCHING' | 'JUDGED' | 'DECIDED' | 'EXECUTED' | 'WATCHING' | 'SETTLED';

// Triage status
export type TriageStatus = 'RELEVANT' | 'IRRELEVANT' | 'AMBIGUOUS';

// Decision action
export type DecisionAction = 'BID' | 'SKIP' | 'WATCH';

// Order side
export type OrderSide = 'YES' | 'NO';

// Research depth

// Risk reason codes enum
export type RiskReasonCode =
  | 'LOW_LIQUIDITY'
  | 'WIDE_SPREAD'
  | 'LOW_EDGE'
  | 'MODERATE_EDGE'
  | 'INSUFFICIENT_EDGE'
  | 'LOW_CONFIDENCE'
  | 'HIGH_UNCERTAINTY'
  | 'CATALYST_TOO_CLOSE'
  | 'CATEGORY_DISABLED'
  | 'DAILY_LIMIT_REACHED'
  | 'CORRELATED_RISK'
  | 'CLUSTER_EXPOSURE_EXCEEDED'
  | 'TAIL_RISK_HIGH'
  | 'CORRELATION_CLUSTER_OVERLAP'
  | 'MANUAL_REVIEW_REQUIRED';

// Agent roles
export type AgentRole = 'TRIAGE' | 'BULL' | 'BEAR' | 'CONTRADICTION' | 'JUDGE' | 'DEERFLOW' | 'NEWS_ANALYST' | 'SENTIMENT_ANALYST' | 'TECHNICAL_ANALYST' | 'REDDIT_ANALYST' | 'X_ANALYST';

// Research status
export type ResearchStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

// Job type
export const JOB_TYPES = [
  'SCAN',
  'SCAN_VENUE',
  'SCORE_CANDIDATES',
  'TRIAGE',
  'TRIAGE_MARKET',
  'RESEARCH',
  'RESEARCH_MARKET',
  'QUICK_RESEARCH',
  'STANDARD_RESEARCH',
  'DEEP_RESEARCH',
  'JUDGE',
  'JUDGE_MARKET',
  'RISK',
  'RISK_CHECK',
  'EXECUTE',
  'PAPER_EXECUTE',
  'LIVE_EXECUTE',
  'ORDER_TRACK',
  'SETTLE',
  'RESOLUTION_CHECK',
] as const;

export type JobType = (typeof JOB_TYPES)[number];

// Job status
export const JOB_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING'] as const;
export const ACTIVE_JOB_STATUSES = ['PENDING', 'RUNNING', 'RETRYING'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// Prompt template state
export type PromptState = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export type PipelineStage = 'triage' | 'bull' | 'bear' | 'contradiction' | 'judge' | 'deerflow' | 'NEWS_ANALYST' | 'SENTIMENT_ANALYST' | 'TECHNICAL_ANALYST' | 'SYNTHESIS';

export type LivePipelineStage =
  | 'SCAN'
  | 'TRIAGE'
  | 'WEB_SEARCH'
  | 'DEERFLOW'
  | 'TRADINGAGENTS'
  | 'AGENT_REACH'
  | 'SYNTHESIS'
  | 'JUDGE'
  | 'RISK'
  | 'DECISION'
  | 'RESOLUTION_CHECK'
  | 'FIRECRAWL'
  | 'MIROFISH_PREDICT';

export type LiveActivityType = 'started' | 'progress' | 'completed' | 'failed' | 'skipped' | 'timeout';

export interface LiveActivityEvent {
  timestamp: string;
  marketId: string;
  marketTitle: string;
  stage: LivePipelineStage;
  provider?: 'deerflow' | 'tradingagents' | 'agent_reach' | 'system';
  type: LiveActivityType;
  terminal?: 'completed' | 'failed' | 'skipped';
  message: string;
  serviceName?: string;
  model?: string | null;
  failureReason?: string | null;
  summary?: string | null;
  references?: TransparencySourceRef[];
}

export interface LiveMarketProgress {
  marketId: string;
  marketTitle: string;
  currentStage: LivePipelineStage | null;
  currentStageStartedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  history: LiveActivityEvent[];
  lastUpdatedAt: string;
}

export interface MetadataOption {
  id: string;
  label: string;
  stale?: boolean;
}

export interface TradingAgentsMetadataResponse {
  providers: MetadataOption[];
  models: MetadataOption[];
  source: 'tradingagents' | 'llm-fallback';
  error?: string;
}

export type TransparencyStageStatus = 'running' | 'completed' | 'failed' | 'skipped' | 'timeout';

export interface TransparencySourceRef {
  title: string;
  url: string;
  domain: string | null;
  snippet: string | null;
  provider: string | null;
  reasonIncluded?: string | null;
}

export interface TransparencyStageRecord {
  stage: string;
  serviceName: string;
  provider: string | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  status: TransparencyStageStatus;
  failureReason: string | null;
  summary: string | null;
  rawOutput: string | null;
  sources: TransparencySourceRef[];
  references: TransparencySourceRef[];
}

export type ResearchDepth = 'QUICK' | 'DEEP' | 'DEERFLOW' | 'FULL' | 'STANDARD';

export interface StageServiceMapping {
  triageModel?: string;
  triageFallbackModels?: string[];
  bullModel?: string;
  bullFallbackModels?: string[];
  bearModel?: string;
  bearFallbackModels?: string[];
  contradictionModel?: string;
  contradictionFallbackModels?: string[];
  judgeModel?: string;
  judgeFallbackModels?: string[];
  deerflowModel?: string;
  deerflowFallbackModels?: string[];
  deerflowApiModel?: string;
  newsAnalystModel?: string;
  newsAnalystFallbackModels?: string[];
  sentimentAnalystModel?: string;
  sentimentAnalystFallbackModels?: string[];
  technicalAnalystModel?: string;
  technicalAnalystFallbackModels?: string[];
  analystDeepThinkLlm?: string;
  analystDeepThinkFallbackModels?: string[];
  analystQuickThinkLlm?: string;
  analystQuickThinkFallbackModels?: string[];
  analystLlmProvider?: string;
  analystMaxDebateRounds?: number;
  searchService?: string;
  searchMaxResults?: number;
  agentReachEnabled?: boolean;
  agentReachServiceUrl?: string;
  agentReachToolName?: string;
  vectorDbCollection?: string;
  embeddingProvider?: string;
  deerflowSearchIterations?: number;
  deerflowQuestionsPerIteration?: number;
  deerflowMaxDepth?: number;
  researchDepth?: ResearchDepth;
  mirofishPredictionModel?: string;
  researchFallbackProvider?: string;
}

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
  promptVersion: Record<string, number>;
  defaultModel?: string;
  triageModel?: string;
  researchModel?: string;
  judgeModel?: string;
  stageRouting?: StageServiceMapping;
  maxMarketsPerScan?: number;
  maxPagesPerVenue?: number;
  scanUntilNoCursor?: boolean;
  scanMode?: ScanMode;
  scanRateLimitMs?: number;
  scanTimeoutMs?: number;
  orderExpiryMinutes?: number;
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
  maxPositionSize?: number;
  maxDailyExposure?: number;
  maxCategoryExposure?: number;
  minLiquidity?: number;
  maxSpread?: number;
  remainingMarketCapacity?: number;
  remainingDailyCapacity?: number;
  remainingCategoryCapacity?: number;
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
  stuckJobsCount: number;
  lockedJobsCount: number;
  retryingJobsCount: number;
  apiHealth: Record<string, 'UP' | 'DOWN' | 'DEGRADED'>;
  venueRateLimits: Record<string, { remaining: number; resetAt: string }>;
  walletSync: 'OK' | 'ERROR' | 'SYNCING';
  dbStatus: 'UP' | 'DOWN';
  vectorStatus: 'UP' | 'DOWN' | 'DEGRADED';
  lastScanAt: string | null;
  uptimeSeconds: number;
  researchProvider?: string | null;
  checkedAt?: string;
}

export type EmbeddingProvider = 'openai' | 'ollama' | 'custom';

export type QdrantDistanceMetric = 'Cosine' | 'Euclid' | 'Dot';

export interface QdrantCollectionInfo {
  name: string;
  vectorsCount: number;
  status: string;
  vectorConfig: {
    size: number;
    distance: QdrantDistanceMetric;
  };
}

export interface QdrantDiscoverResult {
  connected: boolean;
  instanceInfo: {
    version: string;
    mode: string;
  } | null;
  collections: QdrantCollectionInfo[];
  expectedDefaults: Record<string, { found: boolean; name?: string }>;
}

export interface QdrantCollectionLink {
  researchMemory: string;
  marketSearch: string;
  tradeHistory: string;
}

export interface QdrantDefaultCollectionDef {
  key: string;
  defaultName: string;
  description: string;
  payloadIndexes: string[];
}

// ── Correlation & Tail Risk (Phase 10) ──

export type ClusterType = 'EVENT' | 'CATEGORY' | 'RESOLUTION_SOURCE' | 'DATE_WINDOW' | 'UNDERLYING';

export type TailRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ClusterGroup {
  clusterType: ClusterType;
  clusterKey: string;
  label?: string;
  marketIds: string[];
  exposureLimit?: number;
}

export interface ClusterExposure {
  clusterId: string;
  clusterType: ClusterType;
  clusterKey: string;
  label: string | null;
  totalExposure: number;
  exposureLimit: number | null;
  maxLoss: number | null;
  lossToWinRatio: number | null;
  tailRiskLevel: string | null;
  utilization: number;
  marketCount: number;
}

export interface TailRiskMetrics {
  marketId: string;
  marketTitle?: string;
  side: string;
  size: number;
  entryPrice: number;
  maxGain: number;
  maxLoss: number;
  lossToWinRatio: number;
  tailRiskLevel: TailRiskLevel;
}

export interface TailRiskWarning {
  marketId: string;
  marketTitle?: string;
  lossAmount: number;
  winsWiped: number;
  totalWinningPositions: number;
  warning: string;
  severity: TailRiskLevel;
}

export interface ClusterAddResult {
  allowed: boolean;
  reason?: string;
  currentExposure: number;
  exposureLimit: number | null;
  proposedExposure: number;
  utilizationAfter: number;
}

export interface RiskEngineInputExtended extends RiskEngineInput {
  marketId?: string;
  marketTitle?: string;
  resolutionTime?: string | null;
  clusterExposures?: ClusterExposure[];
  clusterOverlaps?: number;
  tailRiskWarnings?: TailRiskWarning[];
}

export interface RiskDashboard {
  totalDailyExposure: number;
  maxDailyExposure: number;
  clusterExposures: ClusterExposure[];
  tailRiskWarnings: TailRiskWarning[];
  openPositionCount: number;
  totalUnrealizedPnl: number;
  riskLimitUtilization: number;
}

export type FillModel = 'DEMO_INSTANT' | 'STRICT_LIMIT' | 'BOOK_DEPTH_AWARE' | 'CONSERVATIVE_PAPER';
export type LegacyFillModel = 'INSTANT' | 'BOOK_AWARE';
export type FillModelInput = FillModel | LegacyFillModel;
export type PaperBetExecutionStatus =
  | 'PLANNED'
  | 'SUBMITTED'
  | 'PARTIAL'
  | 'FILLED'
  | 'FAILED'
  | 'EXPIRED';

export type ScanMode = 'FULL_SCAN' | 'INCREMENTAL_SCAN' | 'RESUME_FROM_CURSOR';

export type RelationshipType =
  | 'SAME_OUTCOME'
  | 'OPPOSITE_OUTCOME'
  | 'A_IMPLIES_B'
  | 'B_IMPLIES_A'
  | 'MUTUALLY_EXCLUSIVE'
  | 'COLLECTIVELY_EXHAUSTIVE'
  | 'NESTED_THRESHOLD'
  | 'RANGE_BUCKET'
  | 'VENUE_DUPLICATE';

export interface APlusSignalConfig {
  minCandidateScore: number;
  minAdjustedEdge: number;
  minConfidence: number;
  minResolutionClarity: number;
  maxSpread: number;
  minLiquidityByCategory: Record<string, number>;
  maxModelDisagreement: number;
  maxTailRisk: number;
  maxOracleRisk: number;
  maxCorrelationExposure: number;
  maxOrderbookAgeSeconds?: number;
}

export type UserRole = 'Admin' | 'ResearchOperator' | 'RiskReviewer' | 'ExecutionReviewer' | 'ReadOnlyViewer';

export interface ApiPermission {
  route: string;
  method: string;
  roles: UserRole[];
  level: 'read-only' | 'operator' | 'admin' | 'dangerous' | 'live-execution';
}

function expandPermissions(
  routes: string[],
  methods: string[],
  roles: UserRole[],
  level: ApiPermission['level'],
): ApiPermission[] {
  return routes.flatMap((route) =>
    methods.map((method) => ({ route, method, roles, level })),
  );
}

const READ_ONLY_ROLES: UserRole[] = ['Admin', 'ResearchOperator', 'RiskReviewer', 'ExecutionReviewer', 'ReadOnlyViewer'];
const OPERATOR_ROLES: UserRole[] = ['Admin', 'ResearchOperator'];
const RISK_OPERATOR_ROLES: UserRole[] = ['Admin', 'ResearchOperator', 'RiskReviewer', 'ExecutionReviewer'];
const ADMIN_ONLY_ROLES: UserRole[] = ['Admin'];

export const API_PERMISSION_MATRIX: ApiPermission[] = [
  ...expandPermissions(['/api/health'], ['GET'], READ_ONLY_ROLES, 'read-only'),
  ...expandPermissions(
    [
      '/api',
      '/api/backtests',
      '/api/backtests/walk-forward',
      '/api/bias',
      '/api/calibration',
      '/api/decisions',
      '/api/deerflow/models',
      '/api/ensemble',
      '/api/jobs',
      '/api/jobs/worker',
      '/api/llm/models',
      '/api/market/[id]/detail',
      '/api/market/[id]/live',
      '/api/markets',
      '/api/mirofish/models',
      '/api/models',
      '/api/orderbook',
      '/api/orders',
      '/api/oracle',
      '/api/outcomes',
      '/api/paper-bets',
      '/api/prompts',
      '/api/qdrant/collections',
      '/api/qdrant/collections/[name]',
      '/api/related-markets',
      '/api/research',
      '/api/research-gating',
      '/api/risk',
      '/api/settings',
      '/api/simulation',
      '/api/strategy',
      '/api/strategy-config',
      '/api/test/quick-sources',
      '/api/test/sources',
      '/api/trading/mode',
      '/api/trading/candidates',
      '/api/trading/market-loop',
      '/api/trading/market-loop/status',
      '/api/trading/operator',
      '/api/trading/orders/open',
      '/api/trading/scan-runs',
      '/api/trading/watchlist',
      '/api/tradingagents/models',
      '/api/verify',
      '/api/wallets',
    ],
    ['GET'],
    READ_ONLY_ROLES,
    'read-only',
  ),
  ...expandPermissions(
    [
      '/api/backtests',
      '/api/backtests/walk-forward',
      '/api/decisions',
      '/api/ensemble',
      '/api/jobs',
      '/api/jobs/worker',
      '/api/markets/sync',
      '/api/models',
      '/api/orderbook',
      '/api/outcomes',
      '/api/paper-bets',
      '/api/pipeline',
      '/api/research',
      '/api/simulation',
      '/api/trading/candidates/[id]/force-research',
      '/api/trading/market-loop',
      '/api/trading/market-loop/start',
      '/api/trading/market-loop/stop',
      '/api/trading/watchlist',
      '/api/verify',
      '/api/wallets',
    ],
    ['POST'],
    OPERATOR_ROLES,
    'operator',
  ),
  ...expandPermissions(
    [
      '/api/deerflow/models',
      '/api/jobs',
      '/api/markets',
      '/api/mirofish/predict',
      '/api/oracle',
      '/api/qdrant/auto-setup',
      '/api/qdrant/collections',
      '/api/qdrant/collections/[name]',
      '/api/qdrant/discover',
      '/api/related-markets',
      '/api/simulation',
      '/api/strategy',
      '/api/strategy-config',
      '/api/strategy-config/sweep',
      '/api/trading/market-loop',
      '/api/verify',
    ],
    ['POST'],
    OPERATOR_ROLES,
    'operator',
  ),
  ...expandPermissions(
    [
      '/api/jobs',
      '/api/outcomes',
      '/api/research',
      '/api/strategy',
      '/api/settings',
      '/api/trading/mode',
      '/api/prompts',
    ],
    ['PUT'],
    ADMIN_ONLY_ROLES,
    'admin',
  ),
  ...expandPermissions(
    [
      '/api/credentials',
      '/api/credentials/test',
      '/api/prompts',
      '/api/qdrant/collections',
      '/api/settings',
      '/api/strategy-config',
      '/api/trading/mode',
    ],
    ['POST'],
    ADMIN_ONLY_ROLES,
    'dangerous',
  ),
  ...expandPermissions(
    ['/api/qdrant/collections/[name]'],
    ['POST', 'DELETE'],
    ADMIN_ONLY_ROLES,
    'dangerous',
  ),
  ...expandPermissions(
    ['/api/credentials'],
    ['GET', 'PUT', 'DELETE'],
    ADMIN_ONLY_ROLES,
    'dangerous',
  ),
  ...expandPermissions(
    ['/api/strategy-config'],
    ['GET', 'PATCH'],
    ADMIN_ONLY_ROLES,
    'admin',
  ),
  ...expandPermissions(
    ['/api/trading/orders/[id]/cancel'],
    ['POST'],
    ADMIN_ONLY_ROLES,
    'live-execution',
  ),
];

export function canAccessRoute(role: UserRole, route: string, method: string): boolean {
  const entry = findApiPermission(route, method);
  if (!entry) return false;
  return entry.roles.includes(role);
}

export function findApiPermission(route: string, method: string): ApiPermission | null {
  const normalizedRoute = route.endsWith('/') ? route.slice(0, -1) : route;
  return (
    API_PERMISSION_MATRIX.find(
      (permission) =>
        permission.method.toUpperCase() === method.toUpperCase() &&
        routePatternToRegex(permission.route).test(normalizedRoute),
    ) ?? null
  );
}

function routePatternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\[id\\\]/g, '[^/]+')
    .replace(/\\\[name\\\]/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}
