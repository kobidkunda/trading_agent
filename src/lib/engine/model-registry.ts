import { db } from '@/lib/db';

export type ModelStatus = 'TESTING' | 'ACTIVE' | 'DISABLED';

export interface ModelRegistryEntry {
  modelName: string;
  version: string;
  provider: string;
  category: string;
  enabled: boolean;
  fallbackPriority: number;
  rollingBrier: number | null;
  sampleSize: number;
  lastEvaluatedAt: Date | null;
  weight: number;
  status: ModelStatus;
}

function toEntry(record: {
  modelName: string;
  version: string;
  provider: string;
  category: string;
  enabled: boolean;
  fallbackPriority: number;
  rollingBrier: number | null;
  sampleSize: number;
  lastEvaluatedAt: Date | null;
  weight: number;
  status: string;
}): ModelRegistryEntry {
  return {
    modelName: record.modelName,
    version: record.version,
    provider: record.provider,
    category: record.category,
    enabled: record.enabled,
    fallbackPriority: record.fallbackPriority,
    rollingBrier: record.rollingBrier,
    sampleSize: record.sampleSize,
    lastEvaluatedAt: record.lastEvaluatedAt,
    weight: record.weight,
    status: record.status as ModelStatus,
  };
}

export class ModelRegistry {
  static async load(): Promise<ModelRegistryEntry[]> {
    const records = await db.modelRegistryRecord.findMany({
      orderBy: [
        { category: 'asc' },
        { status: 'asc' },
        { fallbackPriority: 'asc' },
      ],
    });
    return records.map(toEntry);
  }

  static async registerModel(entry: ModelRegistryEntry): Promise<void> {
    await db.modelRegistryRecord.upsert({
      where: {
        modelName_version_category: {
          modelName: entry.modelName,
          version: entry.version,
          category: entry.category,
        },
      },
      create: {
        modelName: entry.modelName,
        version: entry.version,
        provider: entry.provider,
        category: entry.category,
        enabled: entry.enabled,
        fallbackPriority: entry.fallbackPriority,
        rollingBrier: entry.rollingBrier,
        sampleSize: entry.sampleSize,
        lastEvaluatedAt: entry.lastEvaluatedAt,
        weight: entry.weight,
        status: entry.status,
      },
      update: {
        provider: entry.provider,
        enabled: entry.enabled,
        fallbackPriority: entry.fallbackPriority,
        rollingBrier: entry.rollingBrier,
        sampleSize: entry.sampleSize,
        lastEvaluatedAt: entry.lastEvaluatedAt,
        weight: entry.weight,
        status: entry.status,
      },
    });
  }

  static async getActiveModels(): Promise<ModelRegistryEntry[]> {
    const records = await db.modelRegistryRecord.findMany({
      where: { enabled: true, status: 'ACTIVE' },
      orderBy: [{ category: 'asc' }, { fallbackPriority: 'asc' }],
    });
    return records.map(toEntry);
  }

  static async getModelsByCategory(category: string): Promise<ModelRegistryEntry[]> {
    const records = await db.modelRegistryRecord.findMany({
      where: { category },
      orderBy: [{ status: 'asc' }, { fallbackPriority: 'asc' }],
    });
    return records.map(toEntry);
  }

  static async evaluateModel(modelName: string, category: string, brier: number): Promise<void> {
    const model = await db.modelRegistryRecord.findFirst({
      where: { modelName, category },
      orderBy: { updatedAt: 'desc' },
    });
    if (!model) return;

    const prevBrier = model.rollingBrier;
    const prevN = model.sampleSize;
    const rollingBrier =
      prevBrier === null
        ? brier
        : (prevBrier * prevN + brier) / (prevN + 1);
    const sampleSize = prevN + 1;
    const status =
      rollingBrier > 0.3 && sampleSize >= 25
        ? 'DISABLED'
        : sampleSize >= 10
          ? 'ACTIVE'
          : model.status;

    await db.modelRegistryRecord.update({
      where: { id: model.id },
      data: {
        rollingBrier,
        sampleSize,
        lastEvaluatedAt: new Date(),
        enabled: status !== 'DISABLED',
        status,
      },
    });
  }

  static async getWeights(category?: string): Promise<Record<string, number>> {
    const active = category
      ? await ModelRegistry.getModelsByCategory(category)
      : await ModelRegistry.getActiveModels();
    const eligible = active.filter((model) => model.enabled && model.status === 'ACTIVE');
    if (eligible.length === 0) return {};

    const briers = eligible.map((model) => {
      if (model.rollingBrier === null) return 0.25;
      return Math.max(1 - model.rollingBrier, 0.01);
    });
    const total = briers.reduce((sum, value) => sum + value, 0);

    const weights: Record<string, number> = {};
    for (let i = 0; i < eligible.length; i++) {
      const key = `${eligible[i].modelName}:${eligible[i].category}`;
      weights[key] = total > 0 ? briers[i] / total : 1 / eligible.length;
    }
    return weights;
  }
}
