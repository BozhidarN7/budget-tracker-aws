process.env.TRANSACTIONS_TABLE_NAME = 'test-transactions';
process.env.CATEGORIES_TABLE_NAME = 'test-categories';
process.env.RECURRING_TRANSACTIONS_TABLE_NAME = 'test-recurring';
process.env.USER_TABLE_NAME = 'test-users';

let mockSend: jest.Mock;

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  mockSend = jest.fn();
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => {
      const instance = Object.create(actual.DynamoDBClient.prototype);
      instance.send = mockSend;
      instance.config = { region: 'us-east-1' };
      return instance;
    }),
  };
});

import {
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { RecurringTransaction } from '../types/budget';
import {
  buildMaterializedTransaction,
  materializeDueForUser,
  materializeRecurring,
} from '../utils/recurring';
import {
  queryRecurringByUser,
  resolveCategoryId,
} from '../utils/recurring/store';

const makeRecurring = (
  overrides: Partial<RecurringTransaction> = {},
): RecurringTransaction =>
  ({
    id: 'rec-1',
    description: 'Test sub',
    amount: 100,
    currency: 'EUR',
    baseAmount: 100,
    baseCurrency: 'EUR',
    category: 'cat-1',
    type: 'expense',
    rule: { frequency: 'monthly', startDate: '2026-01-01' },
    nextOccurrence: '2026-05-01',
    status: 'active',
    userId: 'user-1',
    ...overrides,
  }) as RecurringTransaction;

describe('buildMaterializedTransaction (pure)', () => {
  it('copies fields and sets recurrence metadata + deterministic id', () => {
    const rec = makeRecurring({ id: 'rec-xyz', nextOccurrence: '2026-06-15' });
    const txn = buildMaterializedTransaction(rec, '2026-06-15');
    expect(txn.id).toBe('rec-xyz-2026-06-15');
    expect(txn.recurrenceId).toBe('rec-xyz');
    expect(txn.recurrenceInstanceDate).toBe('2026-06-15');
    expect(txn.date).toBe('Jun 15, 2026');
    expect(txn.dateKey).toBe('2026-06-15#rec-xyz-2026-06-15');
    expect(txn.materializedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('materializeDueForUser', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('creates one txn for a due monthly, increments category, advances pointer', async () => {
    const rec = makeRecurring();
    mockSend
      .mockResolvedValueOnce({}) // getUserTimezone falls back
      .mockResolvedValueOnce({ Items: [marshall(rec)] }) // scan query for recurring
      .mockResolvedValueOnce({ Item: undefined }) // txn not exists
      .mockResolvedValueOnce({}) // put txn success
      .mockResolvedValueOnce({ Items: [marshall({ id: 'cat-1' })] }) // cat name scan resolves to id
      .mockResolvedValueOnce({}) // update category
      .mockResolvedValueOnce({}); // put updated recurring

    const summary = await materializeDueForUser('user-1');
    expect(summary.created).toBe(1);
    expect(summary.processed).toBe(1);
    expect(mockSend).toHaveBeenCalledWith(expect.any(PutItemCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateItemCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
  });

  it('skips duplicate and still advances', async () => {
    const rec = makeRecurring();
    mockSend
      .mockResolvedValueOnce({}) // tz
      .mockResolvedValueOnce({ Items: [marshall(rec)] }) // scan
      .mockResolvedValueOnce({ Item: marshall({ id: 'dup' }) }) // exists
      .mockResolvedValueOnce({}); // advance put

    const summary = await materializeDueForUser('user-1');
    expect(summary.skipped).toBe(1);
    expect(summary.created).toBe(0);
  });

  it('ignores paused and completed', async () => {
    const paused = makeRecurring({ id: 'p1', status: 'paused' });
    const completed = makeRecurring({ id: 'c1', status: 'completed' });
    mockSend
      .mockResolvedValueOnce({}) // tz
      .mockResolvedValueOnce({
        Items: [marshall(paused), marshall(completed)],
      }); // scan no actives

    const summary = await materializeDueForUser('user-1');
    expect(summary.processed).toBe(0);
  });

  it('counts failure and does not advance on error', async () => {
    const rec = makeRecurring();
    mockSend
      .mockResolvedValueOnce({}) // tz
      .mockResolvedValueOnce({ Items: [marshall(rec)] }) // scan
      .mockRejectedValueOnce(new Error('boom')); // txn get fails -> materializer catch

    const summary = await materializeDueForUser('user-1');
    expect(summary.failures).toBe(1);
    expect(summary.created).toBe(0);
  });
});

describe('materializeRecurring (batch)', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('processes multiple users and aggregates counts', async () => {
    const r1 = makeRecurring({ id: 'r1', userId: 'u1' });
    const r2 = makeRecurring({ id: 'r2', userId: 'u2' });
    mockSend
      .mockResolvedValueOnce({ Items: [marshall(r1), marshall(r2)] }) // scan
      .mockResolvedValueOnce({}) // tz u1
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({}) // tz u2
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const summary = await materializeRecurring();
    expect(summary.processed).toBe(2);
    expect(summary.created).toBe(2);
  });
});

describe('category spend only for expense', () => {
  beforeEach(() => mockSend.mockReset());

  it('does not call category update for income recurring', async () => {
    const incomeRec = makeRecurring({ type: 'income' });
    mockSend
      .mockResolvedValueOnce({}) // tz
      .mockResolvedValueOnce({ Items: [marshall(incomeRec)] }) // scan
      .mockResolvedValueOnce({ Item: undefined }) // txn
      .mockResolvedValueOnce({}) // put txn
      .mockResolvedValueOnce({}); // advance , no cat scan/update for income

    await materializeDueForUser('user-1');
    const updateCalls = mockSend.mock.calls.filter(
      (c) => c[0] instanceof UpdateItemCommand,
    );
    expect(updateCalls.length).toBe(0);
  });
});

describe('user-scoped recurring helper', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('queries userId-nextOccurrence-index with the user as the key', async () => {
    const rec = makeRecurring();
    mockSend.mockResolvedValueOnce({ Items: [marshall(rec)] });

    const result = await queryRecurringByUser('user-1');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('rec-1');
    const command = mockSend.mock.calls[0][0] as QueryCommand;
    expect(command.input.IndexName).toBe('userId-nextOccurrence-index');
    expect(command.input.KeyConditionExpression).toBe('userId = :userId');
    expect(command.input.ExpressionAttributeValues).toEqual({
      ':userId': { S: 'user-1' },
    });
  });
});

describe('materializeDueForUser uses user-scoped recurring helper', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('queries the user GSI instead of scanning the full table', async () => {
    mockSend.mockResolvedValueOnce({}); // tz
    mockSend.mockResolvedValueOnce({ Items: [] }); // user-scoped recurring query

    await materializeDueForUser('user-1');

    const recurringCalls = mockSend.mock.calls.filter(
      (c) => c[0] instanceof QueryCommand,
    );
    expect(recurringCalls.length).toBe(1);
    const command = recurringCalls[0][0] as QueryCommand;
    expect(command.input.IndexName).toBe('userId-nextOccurrence-index');
    expect(command.input.KeyConditionExpression).toBe('userId = :userId');
    const scanCalls = mockSend.mock.calls.filter(
      (c) => c[0] instanceof ScanCommand,
    );
    expect(scanCalls.length).toBe(0);
  });
});

describe('resolveCategoryId uses user GSI', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('queries userId-name-index for a non-UUID category name', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [marshall({ id: 'cat-1', name: 'Food' })],
    });

    const id = await resolveCategoryId('user-1', 'Food');

    expect(id).toBe('cat-1');
    const command = mockSend.mock.calls[0][0] as QueryCommand;
    expect(command.input.IndexName).toBe('userId-name-index');
    expect(command.input.KeyConditionExpression).toBe(
      'userId = :u AND #n = :n',
    );
    expect(command.input.ExpressionAttributeValues).toEqual({
      ':u': { S: 'user-1' },
      ':n': { S: 'Food' },
    });
    expect(command.input.ExpressionAttributeNames).toEqual({ '#n': 'name' });
  });

  it('returns the input unchanged for UUID-shaped category names', async () => {
    const id = await resolveCategoryId(
      'user-1',
      '11111111-2222-3333-4444-555555555555',
    );
    expect(id).toBe('11111111-2222-3333-4444-555555555555');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
