import type {
  MaterializationSummary,
  RecurringTransaction,
  Transaction,
} from '../../types/budget';
import { BASE_CURRENCY_CODE } from '../currency';
import { getUserTimezone } from '../user-preferences';
import {
  advanceOccurrencePointer,
  getStatusForOccurrence,
  isDueInUserTimezone,
} from './recurrence';
import {
  advanceRecurringPointer,
  incrementCategorySpend,
  putTransactionIfNotExists,
  queryRecurringByUser,
  resolveCategoryId,
  scanAllRecurring,
  transactionExists,
} from './store';

export const buildMaterializedTransaction = (
  recurring: RecurringTransaction,
  occurrenceDate: string,
): Transaction => {
  const instanceId = `${recurring.id}-${occurrenceDate}`;
  return {
    id: instanceId,
    description: recurring.description,
    amount: recurring.amount,
    currency: recurring.currency,
    baseAmount: recurring.baseAmount,
    baseCurrency: recurring.baseCurrency || BASE_CURRENCY_CODE,
    originalAmount: recurring.originalAmount,
    originalCurrency: recurring.originalCurrency,
    displayAmount: recurring.displayAmount,
    displayCurrency: recurring.displayCurrency,
    exchangeRateSnapshot: recurring.exchangeRateSnapshot,
    date: occurrenceDate,
    category: recurring.category,
    type: recurring.type,
    userId: recurring.userId,
    recurrenceId: recurring.id,
    recurrenceInstanceDate: occurrenceDate,
    recurrenceInstanceId: instanceId,
    materializedAt: new Date().toISOString(),
  } as Transaction;
};

const materializeOneOccurrence = async (
  recurring: RecurringTransaction,
  occDate: string,
  summary: MaterializationSummary,
): Promise<void> => {
  const instanceId = `${recurring.id}-${occDate}`;
  try {
    const exists = await transactionExists(instanceId);
    if (exists) {
      summary.skipped += 1;
      await advanceRecurringPointer(recurring, occDate);
      return;
    }

    const txn = buildMaterializedTransaction(recurring, occDate);
    const created = await putTransactionIfNotExists(txn);
    if (!created) {
      summary.skipped += 1;
      await advanceRecurringPointer(recurring, occDate);
      return;
    }

    summary.created += 1;

    if (recurring.type === 'expense' && recurring.category) {
      const catId = await resolveCategoryId(
        recurring.userId,
        recurring.category,
      );
      if (catId) {
        const month = occDate.slice(0, 7);
        const delta =
          Number(recurring.baseAmount ?? recurring.amount ?? 0) || 0;
        await incrementCategorySpend(catId, recurring.userId, month, delta);
      }
    }

    await advanceRecurringPointer(recurring, occDate);
  } catch (err) {
    summary.failures += 1;
    console.error('materializer: failed to materialize occurrence', {
      recurrenceId: recurring.id,
      occDate,
      error: (err as Error).message,
    });
  }
};

const materializeForRule = async (
  recurring: RecurringTransaction,
  timezone: string,
  summary: MaterializationSummary,
): Promise<void> => {
  if (recurring.status !== 'active') return;
  const current = { ...recurring };
  let safety = 0;
  while (
    isDueInUserTimezone(current.nextOccurrence, timezone) &&
    safety < 1000
  ) {
    safety += 1;
    await materializeOneOccurrence(current, current.nextOccurrence, summary);
    current.nextOccurrence = advanceOccurrencePointer(
      current.rule,
      current.nextOccurrence,
    );
    current.status = getStatusForOccurrence(
      current.nextOccurrence,
      current.rule.endDate,
    );
    if (current.status !== 'active') break;
  }
};

export const materializeDueForUser = async (
  userId: string,
): Promise<MaterializationSummary> => {
  const summary: MaterializationSummary = {
    processed: 0,
    created: 0,
    skipped: 0,
    failures: 0,
  };
  const timezone = await getUserTimezone(userId);
  const userRecurring = (await queryRecurringByUser(userId)).filter(
    (r) => r.status === 'active',
  );

  for (const rule of userRecurring) {
    summary.processed += 1;
    await materializeForRule(rule, timezone, summary);
  }
  console.log('materializer: user complete', { userId, ...summary });
  return summary;
};

export const materializeRecurring =
  async (): Promise<MaterializationSummary> => {
    const summary: MaterializationSummary = {
      processed: 0,
      created: 0,
      skipped: 0,
      failures: 0,
    };
    const all = await scanAllRecurring();
    const byUser = new Map<string, RecurringTransaction[]>();
    for (const r of all) {
      if (!byUser.has(r.userId)) byUser.set(r.userId, []);
      byUser.get(r.userId)!.push(r);
    }

    for (const [userId, rules] of byUser.entries()) {
      const timezone = await getUserTimezone(userId);
      for (const rule of rules) {
        summary.processed += 1;
        await materializeForRule(rule, timezone, summary);
      }
    }
    console.log('materializer: batch complete', summary);
    return summary;
  };
