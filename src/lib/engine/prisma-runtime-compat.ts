import { db } from '@/lib/db';

function isUnknownArgumentError(error: unknown, field: string): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(`Unknown argument \`${field}\``);
}

function omitKeys<T extends Record<string, unknown>>(value: T, keys: string[]): Partial<T> {
  const next: Partial<T> = { ...value };
  for (const key of keys) {
    delete next[key as keyof T];
  }
  return next;
}

async function retryWithoutUnsupportedFields<T>(
  operation: (data: Record<string, unknown>) => Promise<T>,
  data: Record<string, unknown>,
  fallbackFields: string[],
): Promise<T> {
  try {
    return await operation(data);
  } catch (error) {
    const unsupportedFields = fallbackFields.filter((field) => isUnknownArgumentError(error, field));
    if (unsupportedFields.length === 0) throw error;
    return operation(omitKeys(data, unsupportedFields));
  }
}

export async function createMarketCompat(data: Record<string, unknown>) {
  return retryWithoutUnsupportedFields(
    (sanitized) => db.market.create({ data: sanitized }),
    data,
    ['dataSource', 'normalizedTitle', 'titleHash', 'firstSeenAt', 'lastSeenAt', 'isActive', 'isClosed', 'isResolved'],
  );
}

export async function createOrderCompat(data: Record<string, unknown>) {
  return retryWithoutUnsupportedFields(
    (sanitized) => db.order.create({ data: sanitized }),
    data,
    ['executionMode', 'dataSource', 'lifecycleStatus', 'remainingSize', 'avgFillPrice', 'failureReason', 'retryCount', 'cancelledAt', 'expiredAt'],
  );
}

export async function updateOrderCompat(orderId: string, data: Record<string, unknown>) {
  return retryWithoutUnsupportedFields(
    (sanitized) => db.order.update({ where: { id: orderId }, data: sanitized }),
    data,
    ['lifecycleStatus', 'remainingSize', 'avgFillPrice', 'cancelledAt', 'expiredAt'],
  );
}
