import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  paginateQuery,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  MaterializationSummary,
  RecurringTransaction,
  Transaction,
} from '../types/budget';
import { BASE_CURRENCY_CODE } from './currency';
import {
  advanceOccurrencePointer,
  getStatusForOccurrence,
  isDueInUserTimezone,
} from './recurrence';
import { getUserTimezone } from './user-preferences';

const client = new DynamoDBClient({});

const TRANSACTIONS_TABLE = process.env.TRANSACTIONS_TABLE_NAME;
const CATEGORIES_TABLE = process.env.CATEGORIES_TABLE_NAME;
const RECURRING_TABLE = process.env.RECURRING_TRANSACTIONS_TABLE_NAME;

const ensureTable = (name: string | undefined, key: string) => {
  if (!name) {
    throw new Error(`${key} is not configured`);
  }
  return name;
};

const getMonthKey = (date: string) => date.slice(0, 7);

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

const transactionExists = async (id: string): Promise<boolean> => {
  const table = ensureTable(TRANSACTIONS_TABLE, 'TRANSACTIONS_TABLE_NAME');
  const res = await client.send(
    new GetItemCommand({
      TableName: table,
      Key: marshall({ id }),
      ProjectionExpression: 'id',
    }),
  );
  return !!res.Item;
};

const putTransactionIfNotExists = async (
  txn: Transaction,
): Promise<boolean> => {
  const table = ensureTable(TRANSACTIONS_TABLE, 'TRANSACTIONS_TABLE_NAME');
  try {
    await client.send(
      new PutItemCommand({
        TableName: table,
        Item: marshall(txn),
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw err;
  }
};

const incrementCategorySpend = async (
  categoryId: string,
  userId: string,
  month: string,
  deltaBase: number,
): Promise<void> => {
  if (!deltaBase || deltaBase <= 0) return;
  const table = ensureTable(CATEGORIES_TABLE, 'CATEGORIES_TABLE_NAME');
  const monthKey = month;
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: table,
        Key: marshall({ id: categoryId }),
        UpdateExpression: `
          SET #md.#m.#bs = if_not_exists(#md.#m.#bs, :zero) + :delta,
              #md.#m.#bl = if_not_exists(#md.#m.#bl, :zero),
              #md.#m.#l = if_not_exists(#md.#m.#l, :zero),
              #md.#m.#s = if_not_exists(#md.#m.#s, :zero)
        `,
        ConditionExpression: 'attribute_exists(id) AND userId = :uid',
        ExpressionAttributeNames: {
          '#md': 'monthlyData',
          '#m': monthKey,
          '#bs': 'baseSpent',
          '#bl': 'baseLimit',
          '#l': 'limit',
          '#s': 'spent',
        },
        ExpressionAttributeValues: marshall({
          ':zero': 0,
          ':delta': deltaBase,
          ':uid': userId,
        }),
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return;
    }
    throw err;
  }
};

const advanceRecurringPointer = async (
  recurring: RecurringTransaction,
  lastOccurrence: string,
): Promise<RecurringTransaction> => {
  const table = ensureTable(
    RECURRING_TABLE,
    'RECURRING_TRANSACTIONS_TABLE_NAME',
  );
  const next = advanceOccurrencePointer(recurring.rule, lastOccurrence);
  const newStatus = getStatusForOccurrence(next, recurring.rule.endDate);
  const updated: RecurringTransaction = {
    ...recurring,
    nextOccurrence: next,
    status: newStatus,
  };
  await client.send(
    new PutItemCommand({
      TableName: table,
      Item: marshall(updated),
    }),
  );
  return updated;
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
      const month = getMonthKey(occDate);
      const delta = recurring.baseAmount ?? 0;
      await incrementCategorySpend(
        recurring.category,
        recurring.userId,
        month,
        delta,
      );
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

const scanAllRecurring = async (): Promise<RecurringTransaction[]> => {
  const table = ensureTable(
    RECURRING_TABLE,
    'RECURRING_TRANSACTIONS_TABLE_NAME',
  );
  const items: RecurringTransaction[] = [];
  const paginator = paginateQuery(
    { client },
    {
      TableName: table,
      IndexName: 'status-nextOccurrence-index',
      KeyConditionExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({ ':active': 'active' }),
    },
  );
  for await (const page of paginator) {
    if (page.Items) {
      items.push(
        ...page.Items.map((i) => unmarshall(i) as RecurringTransaction),
      );
    }
  }
  return items;
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
  const all = await scanAllRecurring();
  const userRecurring = all.filter((r) => r.userId === userId);

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
