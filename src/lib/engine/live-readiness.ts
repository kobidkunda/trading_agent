import { db } from '@/lib/db'

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
    },
  })
  return result
}

async function getAPlusStats(d: typeof db): Promise<{ roi: number | null; brier: number | null }> {
  const configs = await d.strategyConfigVersion.findMany({
    where: {
      aPlusROI: { not: null },
      brierScore: { not: null },
    },
    orderBy: { version: 'desc' },
    take: 1,
  })
  if (configs.length === 0) return { roi: null, brier: null }
  return {
    roi: configs[0].aPlusROI ?? null,
    brier: configs[0].brierScore ?? null,
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

  const checklist: LiveGoNoGoChecklist = {
    paperAPlusSamples: { current: paperCount, required: 500 },
    aPlusRoi: { current: aPlusStats.roi, required: 0 },
    aPlusBrier: { current: aPlusStats.brier, required: 0.25 },
    calibrationAcceptable: { current: aPlusStats.brier !== null && aPlusStats.brier <= 0.25, required: true },
    killSwitchTested: { current: false, required: true },
    manualApprovalEnabled: { current: false, required: true },
    maxStakeConfigured: { current: false, required: true },
    dailyLossConfigured: { current: false, required: true },
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

  const ready = failures.length === 0

  return { ready, checklist, failures }
}
