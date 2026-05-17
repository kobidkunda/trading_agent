export interface OracleRiskResult {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK';
  issues: string[];
  oracleSource: string;
  resolutionCriteria: string;
  deadline: string | null;
  timezone: string | null;
  officialSource: string | null;
  appealProcess: string | null;
  hasAmbiguousWording: boolean;
  hasHumanDiscretion: boolean;
  hasAppealProcess: boolean;
  crossVenueMismatch: number;
}

export const RESOLUTION_CRITERIA_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /resolves?\s+(?:to|at)\s+"?([^"]+)"?\s*(?:on|by|at)\s+(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/i, label: 'resolves-to-date' },
  { regex: /resolution\s+(?:source|criterion|criteria):\s*([^.;]+)/i, label: 'resolution-source' },
  { regex: /determined\s+by\s+([^.;]+)/i, label: 'determined-by' },
  { regex: /official\s+(?:source|report|data)\s+(?:from|by):?\s*([^.;]+)/i, label: 'official-source' },
  { regex: /in\s+the\s+event\s+of\s+([^.;]+)/i, label: 'event-of' },
  { regex: /deadline\s*(?:is\s*)?(\d{4}-\d{2}-\d{2}|\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/i, label: 'deadline' },
  { regex: /appeal\s+(?:window|period|process):\s*([^.;]+)/i, label: 'appeal' },
  { regex: /will\s+be\s+resolved\s+(?:based\s+on|according\s+to|using)\s+([^.;]+)/i, label: 'resolved-based-on' },
  { regex: /if\s+(.+?),\s*(?:then|the\s+market\s+resolves\s+to)/i, label: 'conditional-resolution' },
  { regex: /source\s+(?:of\s+)?(?:truth|resolution):\s*([^.;]+)/i, label: 'source-of-truth' },
]

export function resolutionSourceParsing(rawText: string): {
  resolutionCriteria: string
  deadline: string | null
  timezone: string | null
  officialSource: string | null
  appealProcess: string | null
} {
  let resolutionCriteria = ''
  let deadline: string | null = null
  let timezone: string | null = null
  let officialSource: string | null = null
  let appealProcess: string | null = null

  const tzMatch = rawText.match(/\b(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|UTC|GMT)\b/i)
  if (tzMatch) {
    timezone = tzMatch[0].toUpperCase()
  }

  for (const pattern of RESOLUTION_CRITERIA_PATTERNS) {
    const match = rawText.match(pattern.regex)
    if (!match) continue

    switch (pattern.label) {
      case 'resolves-to-date':
        if (!resolutionCriteria) resolutionCriteria = match[0].trim()
        if (!deadline) deadline = match[2] || match[1]
        break
      case 'resolution-source':
      case 'resolved-based-on':
      case 'source-of-truth':
        if (!resolutionCriteria) resolutionCriteria = match[1].trim()
        if (!officialSource) officialSource = match[1].trim()
        break
      case 'determined-by':
        if (!resolutionCriteria) resolutionCriteria = match[0].trim()
        break
      case 'official-source':
        if (!officialSource) officialSource = match[1].trim()
        break
      case 'deadline':
        if (!deadline) deadline = match[1]
        break
      case 'appeal':
        appealProcess = match[1].trim()
        break
      case 'conditional-resolution':
      case 'event-of':
        if (!resolutionCriteria) resolutionCriteria = match[1].trim()
        break
    }
  }

  return { resolutionCriteria, deadline, timezone, officialSource, appealProcess }
}

export const AMBIGUOUS_PHRASES = [
  'at the discretion of', 'subject to', 'may be', 'could be',
  'potentially', 'approximately', 'around'
]
export const HUMAN_DISCRETION_PHRASES = [
  'committee', 'panel', 'organization decides', 'official ruling', 'determined by'
]
export const APPEAL_PHRASES = ['appeal', 'challenge', 'dispute', 'review', 'overturned']

export function analyzeOracleRisk(market: any): OracleRiskResult {
  const issues: string[] = [];
  const text = (market.title || '') + ' ' + (market.description || '');
  const lowerText = text.toLowerCase();

  const parsed = resolutionSourceParsing(text)

  const hasAmbiguousWording = AMBIGUOUS_PHRASES.some(p => lowerText.includes(p));
  const hasHumanDiscretion = HUMAN_DISCRETION_PHRASES.some(p => lowerText.includes(p));
  const hasAppealProcess = APPEAL_PHRASES.some(p => lowerText.includes(p));

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
    resolutionCriteria: parsed.resolutionCriteria || market.resolutionCriteria || '',
    deadline: parsed.deadline,
    timezone: parsed.timezone,
    officialSource: parsed.officialSource,
    appealProcess: parsed.appealProcess || (hasAppealProcess ? 'appeal mentioned' : null),
    hasAmbiguousWording: hasAmbiguousWording,
    hasHumanDiscretion: hasHumanDiscretion,
    hasAppealProcess,
    crossVenueMismatch: crossVenueMismatchCount,
  };
}
