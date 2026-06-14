import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  UpdateItemCommand,
  paginateQuery,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { RecurringTransaction, Transaction } from '../../types/budget';
import { advanceOccurrencePointer, getStatusForOccurrence } from './recurrence';

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

const transactionExists = async (id: string): Promise<boolean> => {
  const table = ensureTable(TRANSACTIONS_TABLE, 'TRANSACTIONS_TABLE_NAME');
  const res = await client.send(
    new GetItemCommand({
      TableName: table,
      Key: marshall({ id }, { removeUndefinedValues: true }),
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
        Item: marshall(txn, { removeUndefinedValues: true }),
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
  try {
    await client.send(
      new UpdateItemCommand({
        TableName: table,
        Key: marshall({ id: categoryId }, { removeUndefinedValues: true }),
        UpdateExpression: `
          SET #md.#m.#bs = if_not_exists(#md.#m.#bs, :zero) + :delta,
              #md.#m.#bl = if_not_exists(#md.#m.#bl, :zero),
              #md.#m.#l = if_not_exists(#md.#m.#l, :zero),
              #md.#m.#s = if_not_exists(#md.#m.#s, :zero)
        `,
        ConditionExpression: 'attribute_exists(id) AND userId = :uid',
        ExpressionAttributeNames: {
          '#md': 'monthlyData',
          '#m': month,
          '#bs': 'baseSpent',
          '#bl': 'baseLimit',
          '#l': 'limit',
          '#s': 'spent',
        },
        ExpressionAttributeValues: marshall(
          {
            ':zero': 0,
            ':delta': deltaBase,
            ':uid': userId,
          },
          { removeUndefinedValues: true },
        ),
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return;
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
      Item: marshall(updated, { removeUndefinedValues: true }),
    }),
  );
  return updated;
};

const resolveCategoryId = async (
  userId: string,
  category: string,
): Promise<string> => {
  let catId = category;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(catId)) {
    const res = await client.send(
      new QueryCommand({
        TableName: ensureTable(CATEGORIES_TABLE, 'CATEGORIES_TABLE_NAME'),
        IndexName: 'userId-name-index',
        KeyConditionExpression: 'userId = :u AND #n = :n',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: marshall(
          {
            ':u': userId,
            ':n': catId,
          },
          { removeUndefinedValues: true },
        ),
      }),
    );
    catId = res.Items?.map((i) => unmarshall(i))[0]?.id ?? '';
  }
  return catId;
};

const queryRecurringByUser = async (
  userId: string,
): Promise<RecurringTransaction[]> => {
  const table = ensureTable(
    RECURRING_TABLE,
    'RECURRING_TRANSACTIONS_TABLE_NAME',
  );
  const items: RecurringTransaction[] = [];
  const paginator = paginateQuery(
    { client },
    {
      TableName: table,
      IndexName: 'userId-nextOccurrence-index',
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: marshall(
        { ':userId': userId },
        { removeUndefinedValues: true },
      ),
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
      ExpressionAttributeValues: marshall(
        { ':active': 'active' },
        { removeUndefinedValues: true },
      ),
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

export {
  transactionExists,
  putTransactionIfNotExists,
  incrementCategorySpend,
  advanceRecurringPointer,
  resolveCategoryId,
  queryRecurringByUser,
  scanAllRecurring,
};
