/* eslint-disable max-lines*/
import { randomUUID } from 'node:crypto';
import {
  type AttributeValue,
  BatchWriteItemCommand,
  DeleteItemCommand,
  DynamoDBClient,
  ScanCommand,
  type WriteRequest,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  Category,
  Goal,
  RecurringTransaction,
  Transaction,
  UserPreference,
} from '../types/budget.ts';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
});

const TABLE_NAMES = {
  categories: 'categorys-dev',
  goals: 'goals-dev',
  recurring: 'recurring-transactions-dev',
  transactions: 'transactions-dev',
  users: 'users-dev',
} as const;

const BASE_CURRENCY = 'EUR';
const CATEGORY_COUNT = 10;
const GOAL_COUNT = 5;
const RECURRING_COUNT = 5;
const TRANSACTION_COUNT = 100;
const BATCH_SIZE = 25;

type SeedableRecord =
  | Category
  | Goal
  | RecurringTransaction
  | Transaction
  | UserPreference;

type CategoryTemplate = Pick<Category, 'name' | 'color' | 'type'> & {
  monthlyLimit: number;
};

type GoalTemplate = Pick<Goal, 'name' | 'description'> & {
  target: number;
  current: number;
  monthsAhead: number;
};

type RecurringTemplate = {
  description: string;
  amount: number;
  category: string;
  type: 'income' | 'expense';
  frequency: 'weekly' | 'monthly';
  interval?: number;
  startOffsetDays: number;
  nextOffsetDays: number;
  dayOfMonth?: number;
};

type TransactionTemplate = {
  description: string;
  category: string;
  type: 'income' | 'expense';
  min: number;
  max: number;
};

const categoryTemplates: CategoryTemplate[] = [
  { name: 'Groceries', color: '#16a34a', type: 'expense', monthlyLimit: 450 },
  { name: 'Rent', color: '#2563eb', type: 'expense', monthlyLimit: 1200 },
  { name: 'Utilities', color: '#7c3aed', type: 'expense', monthlyLimit: 220 },
  { name: 'Dining Out', color: '#ea580c', type: 'expense', monthlyLimit: 180 },
  { name: 'Transport', color: '#0891b2', type: 'expense', monthlyLimit: 140 },
  {
    name: 'Entertainment',
    color: '#db2777',
    type: 'expense',
    monthlyLimit: 120,
  },
  { name: 'Health', color: '#dc2626', type: 'expense', monthlyLimit: 100 },
  { name: 'Shopping', color: '#9333ea', type: 'expense', monthlyLimit: 250 },
  { name: 'Salary', color: '#15803d', type: 'income', monthlyLimit: 0 },
  { name: 'Freelance', color: '#0f766e', type: 'income', monthlyLimit: 0 },
];

const goalTemplates: GoalTemplate[] = [
  {
    name: 'Emergency Fund',
    description: 'Build a six month safety buffer.',
    target: 12000,
    current: 3400,
    monthsAhead: 12,
  },
  {
    name: 'Vacation',
    description: 'Save for a summer trip.',
    target: 2400,
    current: 900,
    monthsAhead: 8,
  },
  {
    name: 'New Laptop',
    description: 'Replace the current development machine.',
    target: 2600,
    current: 1250,
    monthsAhead: 6,
  },
  {
    name: 'Home Down Payment',
    description: 'Longer term property savings target.',
    target: 30000,
    current: 6500,
    monthsAhead: 24,
  },
  {
    name: 'Year-End Buffer',
    description: 'Reserve cash for annual expenses.',
    target: 3500,
    current: 1100,
    monthsAhead: 7,
  },
];

const recurringTemplates: RecurringTemplate[] = [
  {
    description: 'Monthly Rent',
    amount: 950,
    category: 'Rent',
    type: 'expense',
    frequency: 'monthly',
    startOffsetDays: -180,
    nextOffsetDays: 25,
    dayOfMonth: 1,
  },
  {
    description: 'Internet Bill',
    amount: 36,
    category: 'Utilities',
    type: 'expense',
    frequency: 'monthly',
    startOffsetDays: -180,
    nextOffsetDays: 14,
    dayOfMonth: 12,
  },
  {
    description: 'Gym Membership',
    amount: 29,
    category: 'Health',
    type: 'expense',
    frequency: 'monthly',
    startOffsetDays: -150,
    nextOffsetDays: 9,
    dayOfMonth: 8,
  },
  {
    description: 'Primary Salary',
    amount: 3200,
    category: 'Salary',
    type: 'income',
    frequency: 'monthly',
    startOffsetDays: -180,
    nextOffsetDays: 20,
    dayOfMonth: 28,
  },
  {
    description: 'Weekly Freelance Retainer',
    amount: 280,
    category: 'Freelance',
    type: 'income',
    frequency: 'weekly',
    interval: 1,
    startOffsetDays: -84,
    nextOffsetDays: 6,
  },
];

const expenseTransactionTemplates: TransactionTemplate[] = [
  {
    description: 'Supermarket run',
    category: 'Groceries',
    type: 'expense',
    min: 18,
    max: 95,
  },
  {
    description: 'Top-up groceries',
    category: 'Groceries',
    type: 'expense',
    min: 8,
    max: 34,
  },
  {
    description: 'Restaurant dinner',
    category: 'Dining Out',
    type: 'expense',
    min: 22,
    max: 74,
  },
  {
    description: 'Coffee and snack',
    category: 'Dining Out',
    type: 'expense',
    min: 4,
    max: 14,
  },
  {
    description: 'Metro card recharge',
    category: 'Transport',
    type: 'expense',
    min: 12,
    max: 30,
  },
  {
    description: 'Taxi ride',
    category: 'Transport',
    type: 'expense',
    min: 9,
    max: 24,
  },
  {
    description: 'Streaming subscription',
    category: 'Entertainment',
    type: 'expense',
    min: 8,
    max: 18,
  },
  {
    description: 'Cinema tickets',
    category: 'Entertainment',
    type: 'expense',
    min: 14,
    max: 38,
  },
  {
    description: 'Pharmacy purchase',
    category: 'Health',
    type: 'expense',
    min: 10,
    max: 42,
  },
  {
    description: 'Household essentials',
    category: 'Shopping',
    type: 'expense',
    min: 16,
    max: 88,
  },
  {
    description: 'Utility payment',
    category: 'Utilities',
    type: 'expense',
    min: 45,
    max: 140,
  },
];

const incomeTransactionTemplates: TransactionTemplate[] = [
  {
    description: 'Salary payout',
    category: 'Salary',
    type: 'income',
    min: 3000,
    max: 3400,
  },
  {
    description: 'Freelance invoice',
    category: 'Freelance',
    type: 'income',
    min: 250,
    max: 900,
  },
];

const parseArgs = () => {
  const args = process.argv.slice(2);
  let userId = '';
  let reset = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--userId' || arg === '-u') {
      userId = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--reset') {
      reset = true;
    }
  }

  if (!userId) {
    throw new Error('Missing required --userId argument');
  }

  return { userId, reset };
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number): Date => {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

const addMonths = (date: Date, months: number): Date => {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const randomBetween = (min: number, max: number): number =>
  Number((Math.random() * (max - min) + min).toFixed(2));

const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const pickFrom = <T>(items: T[]): T => items[randomInt(0, items.length - 1)]!;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const buildUserPreference = (userId: string): UserPreference => ({
  userId,
  preferredCurrency: BASE_CURRENCY,
  updatedAt: new Date().toISOString(),
});

const buildCategories = (userId: string): Category[] => {
  const now = new Date();
  const months = Array.from({ length: 4 }, (_, index) =>
    addMonths(now, -index).toISOString().slice(0, 7),
  ).reverse();

  return categoryTemplates.slice(0, CATEGORY_COUNT).map((template, index) => {
    const monthlyData = Object.fromEntries(
      months.map((month, monthIndex) => {
        if (template.type === 'income') {
          return [
            month,
            {
              limit: 0,
              spent: 0,
              baseLimit: 0,
              baseSpent: 0,
            },
          ];
        }

        const multiplier = 0.45 + monthIndex * 0.12 + index * 0.01;
        const baseLimit = template.monthlyLimit;
        const baseSpent = Number((baseLimit * multiplier).toFixed(2));

        return [
          month,
          {
            limit: baseLimit,
            spent: baseSpent,
            baseLimit,
            baseSpent,
          },
        ];
      }),
    );

    return {
      id: randomUUID(),
      userId,
      name: template.name,
      color: template.color,
      type: template.type,
      currency: BASE_CURRENCY,
      baseCurrency: BASE_CURRENCY,
      monthlyData,
    };
  });
};

const buildGoals = (userId: string): Goal[] => {
  const now = new Date();

  return goalTemplates.slice(0, GOAL_COUNT).map((template) => ({
    id: randomUUID(),
    userId,
    name: template.name,
    description: template.description,
    target: template.target,
    current: template.current,
    targetDate: toIsoDate(addMonths(now, template.monthsAhead)),
    currency: BASE_CURRENCY,
    baseCurrency: BASE_CURRENCY,
  }));
};

const buildRecurringTransactions = (userId: string): RecurringTransaction[] => {
  const now = new Date();

  return recurringTemplates.slice(0, RECURRING_COUNT).map((template) => {
    const startDate = addDays(now, template.startOffsetDays);
    const nextDate = addDays(now, template.nextOffsetDays);

    return {
      id: randomUUID(),
      userId,
      description: template.description,
      amount: template.amount,
      currency: BASE_CURRENCY,
      baseAmount: template.amount,
      baseCurrency: BASE_CURRENCY,
      originalAmount: template.amount,
      originalCurrency: BASE_CURRENCY,
      category: template.category,
      type: template.type,
      rule: {
        frequency: template.frequency,
        interval: template.interval,
        startDate: toIsoDate(startDate),
        dayOfMonth: template.dayOfMonth,
      },
      nextOccurrence: toIsoDate(nextDate),
      status: 'active',
    };
  });
};

const buildTransactions = (userId: string): Transaction[] => {
  const now = new Date();
  const transactions: Transaction[] = [];

  for (let index = 0; index < TRANSACTION_COUNT; index += 1) {
    const isIncome = index % 9 === 0;
    const template = isIncome
      ? pickFrom(incomeTransactionTemplates)
      : pickFrom(expenseTransactionTemplates);
    const amount = randomBetween(template.min, template.max);
    const date = addDays(now, -randomInt(0, 180));

    transactions.push({
      id: randomUUID(),
      userId,
      description: template.description,
      amount,
      currency: BASE_CURRENCY,
      baseAmount: amount,
      baseCurrency: BASE_CURRENCY,
      originalAmount: amount,
      originalCurrency: BASE_CURRENCY,
      date: toIsoDate(date),
      category: template.category,
      type: template.type,
    });
  }

  return transactions.sort((left, right) =>
    left.date.localeCompare(right.date),
  );
};

const buildDeleteRequests = async (
  tableName: string,
  userId: string,
): Promise<WriteRequest[]> => {
  const requests: WriteRequest[] = [];
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;

  do {
    const response = await client.send(
      new ScanCommand({
        TableName: tableName,
        ConsistentRead: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    for (const item of response.Items ?? []) {
      const record = unmarshall(item) as Record<string, unknown>;
      const recordUserId = record.userId;
      if (recordUserId !== userId) {
        continue;
      }

      const keyName = tableName === TABLE_NAMES.users ? 'userId' : 'id';
      const keyValue = record[keyName];
      if (typeof keyValue !== 'string') {
        continue;
      }

      requests.push({
        DeleteRequest: {
          Key: marshall({ [keyName]: keyValue }),
        },
      });
    }

    exclusiveStartKey = response.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return requests;
};

const sendBatchWrite = async (
  tableName: string,
  requests: WriteRequest[],
): Promise<void> => {
  let pending = requests;
  let attempts = 0;

  while (pending.length > 0) {
    attempts += 1;

    if (attempts > 10) {
      throw new Error(
        `Failed processing all batch items for ${tableName} after ${attempts - 1} retries`,
      );
    }

    const response = await client.send(
      new BatchWriteItemCommand({
        RequestItems: { [tableName]: pending },
      }),
    );

    pending = response.UnprocessedItems?.[tableName] ?? [];
    if (pending.length > 0) {
      await sleep(100 * attempts);
    }
  }
};

const batchWrite = async (
  tableName: string,
  items: SeedableRecord[],
): Promise<void> => {
  const writeRequests = items.map((item) => ({
    PutRequest: {
      Item: marshall(item, { removeUndefinedValues: true }),
    },
  }));

  for (const group of chunk(writeRequests, BATCH_SIZE)) {
    try {
      await sendBatchWrite(tableName, group);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed writing to ${tableName}: ${message}`);
    }
  }
};

const batchDelete = async (
  tableName: string,
  deleteRequests: WriteRequest[],
): Promise<void> => {
  for (const group of chunk(deleteRequests, BATCH_SIZE)) {
    try {
      await sendBatchWrite(tableName, group);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed deleting from ${tableName}: ${message}`);
    }
  }
};

const resetUserData = async (userId: string): Promise<void> => {
  const tables = [
    TABLE_NAMES.transactions,
    TABLE_NAMES.categories,
    TABLE_NAMES.goals,
    TABLE_NAMES.recurring,
    TABLE_NAMES.users,
  ];

  for (const tableName of tables) {
    const deleteRequests = await buildDeleteRequests(tableName, userId);
    if (deleteRequests.length > 0) {
      await batchDelete(tableName, deleteRequests);
    }
  }

  for (const tableName of tables) {
    const remainingRequests = await buildDeleteRequests(tableName, userId);
    if (remainingRequests.length > 0) {
      throw new Error(
        `Reset did not fully clear ${tableName} for user ${userId}; ${remainingRequests.length} items remain`,
      );
    }
  }
};

const writeUserPreference = async (
  preference: UserPreference,
): Promise<void> => {
  await client.send(
    new DeleteItemCommand({
      TableName: TABLE_NAMES.users,
      Key: marshall({ userId: preference.userId }),
    }),
  );

  await batchWrite(TABLE_NAMES.users, [preference]);
};

const main = async (): Promise<void> => {
  const { userId, reset } = parseArgs();

  if (reset) {
    await resetUserData(userId);
  }

  const categories = buildCategories(userId);
  const goals = buildGoals(userId);
  const recurringTransactions = buildRecurringTransactions(userId);
  const transactions = buildTransactions(userId);
  const preference = buildUserPreference(userId);

  await writeUserPreference(preference);
  await batchWrite(TABLE_NAMES.categories, categories);
  await batchWrite(TABLE_NAMES.goals, goals);
  await batchWrite(TABLE_NAMES.recurring, recurringTransactions);
  await batchWrite(TABLE_NAMES.transactions, transactions);

  const total =
    categories.length +
    goals.length +
    recurringTransactions.length +
    transactions.length +
    1;

  const spendTotal = transactions
    .filter((item) => item.type === 'expense')
    .reduce((sum, item) => sum + (item.baseAmount ?? 0), 0);
  const incomeTotal = transactions
    .filter((item) => item.type === 'income')
    .reduce((sum, item) => sum + (item.baseAmount ?? 0), 0);

  console.log(
    [
      `Seeded dev data for user ${userId}`,
      `Categories: ${categories.length}`,
      `Goals: ${goals.length}`,
      `Recurring transactions: ${recurringTransactions.length}`,
      `Transactions: ${transactions.length}`,
      `User preference: 1`,
      `Ordinary income total: ${clamp(Number(incomeTotal.toFixed(2)), 0, Number.MAX_SAFE_INTEGER)}`,
      `Ordinary expense total: ${clamp(Number(spendTotal.toFixed(2)), 0, Number.MAX_SAFE_INTEGER)}`,
      `Total records written: ${total}`,
    ].join('\n'),
  );
};

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Unknown seed script error',
  );
  process.exitCode = 1;
});
