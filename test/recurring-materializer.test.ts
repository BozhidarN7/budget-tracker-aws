process.env.TRANSACTIONS_TABLE_NAME = 'test-transactions';
process.env.CATEGORIES_TABLE_NAME = 'test-categories';
process.env.RECURRING_TRANSACTIONS_TABLE_NAME = 'test-recurring';
process.env.USER_TABLE_NAME = 'test-users';

import {
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import type { RecurringTransaction } from '../types/budget';
import {
  buildMaterializedTransaction,
  materializeDueForUser,
  materializeRecurring,
} from '../utils/recurring-materializer';

jest.mock('@aws-sdk/client-dynamodb');

const mockSend = jest.fn();

(DynamoDBClient as jest.Mock).mockImplementation(() => ({
  send: mockSend,
}));

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
    expect(txn.date).toBe('2026-06-15');
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
      .mockResolvedValueOnce({ Items: [marshall(rec)] }) // scan
      .mockResolvedValueOnce({}) // getUserTimezone falls back
      .mockResolvedValueOnce({ Item: undefined }) // txn not exists
      .mockResolvedValueOnce({}) // put txn success
      .mockResolvedValueOnce({}) // update category
      .mockResolvedValueOnce({}); // put updated recurring

    const summary = await materializeDueForUser('user-1');
    expect(summary.created).toBe(1);
    expect(summary.processed).toBe(1);
    expect(mockSend).toHaveBeenCalledWith(expect.any(PutItemCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(UpdateItemCommand));
  });

  it('skips duplicate and still advances', async () => {
    const rec = makeRecurring();
    mockSend
      .mockResolvedValueOnce({ Items: [marshall(rec)] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: marshall({ id: 'dup' }) }) // exists
      .mockResolvedValueOnce({}); // advance put

    const summary = await materializeDueForUser('user-1');
    expect(summary.skipped).toBe(1);
    expect(summary.created).toBe(0);
  });

  it('ignores paused and completed', async () => {
    const paused = makeRecurring({ id: 'p1', status: 'paused' });
    const completed = makeRecurring({ id: 'c1', status: 'completed' });
    mockSend.mockResolvedValueOnce({
      Items: [marshall(paused), marshall(completed)],
    });

    const summary = await materializeDueForUser('user-1');
    expect(summary.processed).toBe(0);
  });

  it('counts failure and does not advance on error', async () => {
    const rec = makeRecurring();
    mockSend
      .mockResolvedValueOnce({ Items: [marshall(rec)] })
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('boom'));

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
      .mockResolvedValueOnce({ Items: [marshall(incomeRec)] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({}); // only the recurring advance, no category update

    await materializeDueForUser('user-1');
    const updateCalls = mockSend.mock.calls.filter(
      (c) => c[0] instanceof UpdateItemCommand,
    );
    expect(updateCalls.length).toBe(0);
  });
});
