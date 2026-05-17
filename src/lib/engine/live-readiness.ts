import { db } from '@/lib/db'
import { getLiveGovernanceSettings } from '@/lib/engine/live-governance'

export interface LiveGoNoGoChecklist {
  paperAPlusSamples: { current: number; required: 500 }
  aPlusRoi: { current: number | null; required: 0 }
  aPlusBrier: { current: number | null; required: 0.25 }
  calibrationAcceptable: { current: boolean; required: true }
  killSwitchTested: { current: boolean; required: true }
  manualApprovalEnabled: { current: boolean; required: true }
  maxStakeConfigured: { current: boolean; required: true }
  dailyLossConfigured: { current: boolean; required: true }
  credentialSafetyChecked: { current: boolean; required: true }
  auditLogEnabled: { current: boolean; required: true }
}

async function countPaperAPlus(d: typeof db): Promise<number> {
  const result = await d.paperBet.count({
    where: {
      resolvedAt: { not: null },
      brierScore: { not: null },
      market: { dataSource: 'REAL' },
      decision: { mode: 'PAPER' },
      setupType: 'A_PLUS_BET',
      aPlusStatus: 'PASSED',
    },
  })
  return result
}

async function getAPlusStats(d: typeof db): Promise<{ roi: number | null; brier: number | null }> {
  const bets = await d.paperBet.findMany({
    where: {
      resolvedAt: { not: null },
      brierScore: { not: null },
      market: { dataSource: 'REAL' },
      decision: { mode: 'PAPER' },
      setupType: 'A_PLUS_BET',
      aPlusStatus: 'PASSED',
    },
    select: { pnl: true, brierScore: true, stake: true },
  })

  if (bets.length === 0) return { roi: null, brier: null }

  const totalStake = bets.reduce((sum, bet) => sum + bet.stake, 0)
  const totalPnl = bets.reduce((sum, bet) => sum + (bet.pnl ?? 0), 0)
  const totalBrier = bets.reduce((sum, bet) => sum + (bet.brierScore ?? 0), 0)

  return {
    roi: totalStake > 0 ? totalPnl / totalStake : null,
    brier: bets.length > 0 ? totalBrier / bets.length : null,
  }
}

async function credentialSafetyCheck(d: typeof db): Promise<boolean> {
  const failed = await d.credential.findFirst({
    where: {
      isActive: true,
      testResult: 'FAILED',
    },
  })
  return failed === null
}

async function auditLogCheck(d: typeof db): Promise<boolean> {
  const count = await d.auditLog.count({ take: 1 })
  return count > 0
}

export async function checkLiveReadiness(d: typeof db = db): Promise<{
  ready: boolean
  checklist: LiveGoNoGoChecklist
  failures: string[]
}> {
  const paperCount = await countPaperAPlus(d)
  const aPlusStats = await getAPlusStats(d)
  const credSafe = await credentialSafetyCheck(d)
  const auditActive = await auditLogCheck(d)
  const [readinessSettings, strategySetting, tradingConfigSetting, governance] = await Promise.all([
    d.settings.findMany({
      where: {
        key: {
          in: [
            'kill_switch_tested',
            'manual_approval_enabled',
            'max_stake_configured',
            'daily_loss_configured',
            'daily_loss_limit',
          ],
        },
      },
    }),
    d.settings.findUnique({ where: { key: 'strategy_settings' } }),
    d.settings.findUnique({ where: { key: 'trading_config' } }),
    getLiveGovernanceSettings(),
  ])
  const readinessMap = new Map(readinessSettings.map((setting) => [setting.key, setting.value]))
  const isEnabled = (key: string) => readinessMap.get(key) === 'true'
  const strategySettings = strategySetting?.value ? JSON.parse(strategySetting.value) as Record<string, unknown> : {}
  const tradingConfig = tradingConfigSetting?.value ? JSON.parse(tradingConfigSetting.value) as Record<string, unknown> : {}
  const maxStakeConfigured =
    isEnabled('max_stake_configured') ||
    (typeof strategySettings.maxExposurePerMarket === 'number' && strategySettings.maxExposurePerMarket > 0) ||
    (typeof tradingConfig.maxPaperPositionSize === 'number' && tradingConfig.maxPaperPositionSize > 0)
  const dailyLossConfigured =
    isEnabled('daily_loss_configured') ||
    (typeof readinessMap.get('daily_loss_limit') === 'string' && Number(readinessMap.get('daily_loss_limit')) > 0) ||
    governance.maxDailyLoss > 0

  const checklist: LiveGoNoGoChecklist = {
    paperAPlusSamples: { current: paperCount, required: 500 },
    aPlusRoi: { current: aPlusStats.roi, required: 0 },
    aPlusBrier: { current: aPlusStats.brier, required: 0.25 },
    calibrationAcceptable: { current: aPlusStats.brier !== null && aPlusStats.brier <= 0.25, required: true },
    killSwitchTested: {
      current: isEnabled('kill_switch_tested') || (governance.killSwitchLastTestResult === 'PASS' && governance.killSwitchLastTestedAt !== null),
      required: true,
    },
    manualApprovalEnabled: {
      current: isEnabled('manual_approval_enabled') || governance.manualApprovalRequired,
      required: true,
    },
    maxStakeConfigured: {
      current: maxStakeConfigured || governance.maxStakePerMarket > 0,
      required: true,
    },
    dailyLossConfigured: { current: dailyLossConfigured, required: true },
    credentialSafetyChecked: { current: credSafe, required: true },
    auditLogEnabled: { current: auditActive, required: true },
  }

  const failures: string[] = []

  if (paperCount < 500) {
    failures.push(`Paper A+ samples: ${paperCount}/500 (need ${500 - paperCount} more)`)
  }
  if (aPlusStats.roi === null || aPlusStats.roi < 0) {
    failures.push('A+ ROI not positive or unavailable')
  }
  if (aPlusStats.brier === null || aPlusStats.brier > 0.25) {
    failures.push(`A+ Brier score ${aPlusStats.brier?.toFixed(4) ?? 'N/A'} exceeds 0.25 threshold`)
  }
  if (!credSafe) {
    failures.push('One or more active credentials have failed tests')
  }
  if (!auditActive) {
    failures.push('Audit log has no entries')
  }
  if (!checklist.killSwitchTested.current) {
    failures.push('Kill switch test not recorded')
  }
  if (!checklist.manualApprovalEnabled.current) {
    failures.push('Manual approval not enabled')
  }
  if (!checklist.maxStakeConfigured.current) {
    failures.push('Max stake not configured')
  }
  if (!checklist.dailyLossConfigured.current) {
    failures.push('Daily loss not configured')
  }

  const ready = failures.length === 0

  return { ready, checklist, failures }
}
