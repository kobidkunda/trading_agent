import { db } from '@/lib/db';

export const LIVE_GOVERNANCE_SETTINGS_KEY = 'live_governance_settings';

export interface LiveGovernanceSettings {
  liveEnabled: boolean;
  killSwitchEnabled: boolean;
  killSwitchLastTestedAt: string | null;
  killSwitchLastTestResult: 'PASS' | 'FAIL' | 'NOT_TESTED';
  manualApprovalRequired: boolean;
  maxStakePerMarket: number;
  maxDailyLoss: number;
  maxUnresolvedExposure: number;
  maxCategoryExposure: number;
  maxClusterExposure: number;
  liveModeApprovedBy: string | null;
  liveModeApprovedAt: string | null;
}

export const DEFAULT_LIVE_GOVERNANCE_SETTINGS: LiveGovernanceSettings = {
  liveEnabled: false,
  killSwitchEnabled: true,
  killSwitchLastTestedAt: null,
  killSwitchLastTestResult: 'NOT_TESTED',
  manualApprovalRequired: true,
  maxStakePerMarket: 0,
  maxDailyLoss: 0,
  maxUnresolvedExposure: 0,
  maxCategoryExposure: 0,
  maxClusterExposure: 0,
  liveModeApprovedBy: null,
  liveModeApprovedAt: null,
};

export function normalizeLiveGovernanceSettings(
  input: Partial<LiveGovernanceSettings> | null | undefined,
): LiveGovernanceSettings {
  return {
    ...DEFAULT_LIVE_GOVERNANCE_SETTINGS,
    ...(input ?? {}),
    liveEnabled: Boolean(input?.liveEnabled),
    killSwitchEnabled: input?.killSwitchEnabled ?? true,
    manualApprovalRequired: input?.manualApprovalRequired ?? true,
    maxStakePerMarket: Math.max(0, input?.maxStakePerMarket ?? 0),
    maxDailyLoss: Math.max(0, input?.maxDailyLoss ?? 0),
    maxUnresolvedExposure: Math.max(0, input?.maxUnresolvedExposure ?? 0),
    maxCategoryExposure: Math.max(0, input?.maxCategoryExposure ?? 0),
    maxClusterExposure: Math.max(0, input?.maxClusterExposure ?? 0),
  };
}

export async function getLiveGovernanceSettings(): Promise<LiveGovernanceSettings> {
  const setting = await db.settings.findUnique({
    where: { key: LIVE_GOVERNANCE_SETTINGS_KEY },
  });

  if (!setting?.value) {
    return DEFAULT_LIVE_GOVERNANCE_SETTINGS;
  }

  try {
    return normalizeLiveGovernanceSettings(JSON.parse(setting.value) as Partial<LiveGovernanceSettings>);
  } catch {
    return DEFAULT_LIVE_GOVERNANCE_SETTINGS;
  }
}

export async function saveLiveGovernanceSettings(
  input: Partial<LiveGovernanceSettings>,
): Promise<LiveGovernanceSettings> {
  const current = await getLiveGovernanceSettings();
  const merged = normalizeLiveGovernanceSettings({ ...current, ...input });

  await db.settings.upsert({
    where: { key: LIVE_GOVERNANCE_SETTINGS_KEY },
    update: {
      value: JSON.stringify(merged),
      updatedAt: new Date(),
    },
    create: {
      key: LIVE_GOVERNANCE_SETTINGS_KEY,
      value: JSON.stringify(merged),
      description: 'Live trading governance and safety settings',
    },
  });

  return merged;
}
