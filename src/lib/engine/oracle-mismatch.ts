export interface OracleRiskResult {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK';
  issues: string[];
  oracleSource: string;
  hasAmbiguousWording: boolean;
  hasHumanDiscretion: boolean;
  hasAppealProcess: boolean;
  crossVenueMismatchCount: number;
}

export function analyzeOracleRisk(market: any): OracleRiskResult {
  const issues: string[] = [];
  const text = (market.title || '') + ' ' + (market.description || '');
  const lowerText = text.toLowerCase();

  const ambiguousPhrases = [
    'at the discretion of', 'subject to', 'may be', 'could be', 
    'potentially', 'approximately', 'around'
  ];
  const humanDiscretionPhrases = [
    'committee', 'panel', 'organization decides', 'official ruling', 'determined by'
  ];
  const appealPhrases = ['appeal', 'challenge', 'dispute', 'review', 'overturned'];

  const hasAmbiguousWording = ambiguousPhrases.some(p => lowerText.includes(p));
  const hasHumanDiscretion = humanDiscretionPhrases.some(p => lowerText.includes(p));
  const hasAppealProcess = appealPhrases.some(p => lowerText.includes(p));

  if (hasAmbiguousWording) issues.push('Ambiguous wording detected');
  if (hasHumanDiscretion) issues.push('Human discretion involved');
  if (hasAppealProcess) issues.push('Appeal process mentioned');

  const crossVenueMismatchCount = market.crossVenueMismatch || 0;
  if (crossVenueMismatchCount > 0) issues.push('Cross-venue mismatch detected');

  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK' = 'LOW';
  
  const ambiguityFlags = [hasAmbiguousWording, hasHumanDiscretion, crossVenueMismatchCount > 0].filter(Boolean).length;

  if (hasAmbiguousWording && hasHumanDiscretion && crossVenueMismatchCount > 0) {
    riskLevel = 'BLOCK';
  } else if ((hasAmbiguousWording && hasHumanDiscretion) || 
             (hasAmbiguousWording && crossVenueMismatchCount > 0) || 
             (hasHumanDiscretion && crossVenueMismatchCount > 0)) {
    riskLevel = 'HIGH';
  } else if (ambiguityFlags >= 1) {
    riskLevel = 'MEDIUM';
  }

  return {
    riskLevel,
    issues,
    oracleSource: market.oracleSource || 'unknown',
    hasAmbiguousWording,
    hasHumanDiscretion,
    hasAppealProcess,
    crossVenueMismatchCount
  };
}
