export type ModelStatus = 'TESTING' | 'ACTIVE' | 'DISABLED'

export interface ModelRegistryEntry {
  modelName: string
  version: string
  provider: string
  category: string
  enabled: boolean
  fallbackPriority: number
  rollingBrier: number | null
  sampleSize: number
  lastEvaluatedAt: Date | null
  weight: number
  status: ModelStatus
}

export class ModelRegistry {
  private static models: ModelRegistryEntry[] = []

  static registerModel(entry: ModelRegistryEntry): void {
    const existing = ModelRegistry.models.findIndex(
      m => m.modelName === entry.modelName && m.version === entry.version
    )
    if (existing >= 0) {
      ModelRegistry.models[existing] = entry
    } else {
      ModelRegistry.models.push(entry)
    }
  }

  static getActiveModels(): ModelRegistryEntry[] {
    return ModelRegistry.models.filter(m => m.enabled && m.status === 'ACTIVE')
  }

  static getModelsByCategory(category: string): ModelRegistryEntry[] {
    return ModelRegistry.models.filter(m => m.category === category)
  }

  static evaluateModel(modelName: string, brier: number): void {
    const model = ModelRegistry.models.find(m => m.modelName === modelName)
    if (!model) return

    const prevBrier = model.rollingBrier
    const prevN = model.sampleSize
    if (prevBrier === null) {
      model.rollingBrier = brier
      model.sampleSize = 1
    } else {
      model.rollingBrier = (prevBrier * prevN + brier) / (prevN + 1)
      model.sampleSize = prevN + 1
    }
    model.lastEvaluatedAt = new Date()

    if (model.rollingBrier !== null && model.rollingBrier > 0.3) {
      model.status = 'DISABLED'
      model.enabled = false
    }
  }

  static getWeights(): Record<string, number> {
    const active = ModelRegistry.getActiveModels()
    if (active.length === 0) return {}

    const briers = active.map(m => {
      if (m.rollingBrier === null) return 0.25
      return Math.max(1 - m.rollingBrier, 0.01)
    })
    const total = briers.reduce((sum, b) => sum + b, 0)

    const weights: Record<string, number> = {}
    for (let i = 0; i < active.length; i++) {
      weights[active[i].modelName] = total > 0 ? briers[i] / total : 1 / active.length
    }
    return weights
  }
}
