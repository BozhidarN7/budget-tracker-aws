process.env.TABLE_NAME = 'test-recurring';

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

jest.mock('../utils', () => ({
  BASE_CURRENCY_CODE: 'EUR',
  buildResponse: jest.requireActual('../utils/build-response').default,
  computeNextOccurrence: jest.requireActual('../utils/recurring/recurrence')
    .computeNextOccurrence,
  convertFromBaseCurrency: jest.fn(
    async (amount: number, currency: string) => ({
      amount,
      snapshot: {
        fromCurrency: 'EUR',
        toCurrency: currency,
        rate: 1,
        provider: 'test',
        capturedAt: '2026-01-01T00:00:00.000Z',
      },
    }),
  ),
  convertToBaseCurrency: jest.fn(async (amount: number, currency: string) => ({
    baseAmount: amount,
    snapshot: {
      fromCurrency: currency,
      toCurrency: 'EUR',
      rate: 1,
      provider: 'test',
      capturedAt: '2026-01-01T00:00:00.000Z',
    },
  })),
  createRateContext: jest.fn(() => ({ source: 'test' })),
  getStatusForOccurrence: jest.requireActual('../utils/recurring/recurrence')
    .getStatusForOccurrence,
  getUserPreferredCurrency: jest.fn(async () => 'EUR'),
  normalizeCurrencyCode: jest.fn((currency: string) => currency),
  normalizeRecurringRule: jest.requireActual('../utils/recurring/recurrence')
    .normalizeRecurringRule,
  toCurrencyNumber: jest.fn((value: unknown) => Number(value)),
  validateRecurringRule: jest.requireActual('../utils/recurring/recurrence')
    .validateRecurringRule,
}));

import { QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { APIGatewayEvent } from 'aws-lambda';
import { handler } from '../lambdas/recurring-transactions/handler';
import type { RecurringTransaction } from '../types/budget';

const buildEvent = (
  overrides: Partial<APIGatewayEvent> = {},
): APIGatewayEvent => {
  const baseRequestContext = {
    accountId: '123',
    apiId: 'api-id',
    authorizer: { claims: { sub: 'user-1' } },
    protocol: 'HTTP/1.1',
    httpMethod: 'GET',
    identity: {} as APIGatewayEvent['requestContext']['identity'],
    path: '/recurring-transactions',
    requestId: 'request-id',
    requestTimeEpoch: 0,
    resourceId: 'resource-id',
    resourcePath: '/recurring-transactions',
    stage: 'dev',
  };
  return {
    body: null,
    headers: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path: '/recurring-transactions',
    pathParameters: null,
    queryStringParameters: null,
    requestContext: {
      ...baseRequestContext,
      ...(overrides.requestContext ?? {}),
    },
    resource: '/recurring-transactions',
    stageVariables: null,
    ...overrides,
  } as APIGatewayEvent;
};

const makeRecurring = (
  overrides: Partial<RecurringTransaction> = {},
): RecurringTransaction =>
  ({
    id: 'rec-1',
    description: 'Netflix',
    amount: 10,
    currency: 'EUR',
    baseAmount: 10,
    baseCurrency: 'EUR',
    originalAmount: 10,
    originalCurrency: 'EUR',
    category: 'cat-1',
    type: 'expense',
    rule: { frequency: 'monthly', startDate: '2026-01-01' },
    nextOccurrence: '2026-06-01',
    status: 'active',
    userId: 'user-1',
    ...overrides,
  }) as RecurringTransaction;

describe('recurring-transactions handler GET list', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('queries the user GSI ascending by next occurrence', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          id: { S: 'rec-1' },
          description: { S: 'Netflix' },
          amount: { N: '10' },
          currency: { S: 'EUR' },
          baseAmount: { N: '10' },
          baseCurrency: { S: 'EUR' },
          originalAmount: { N: '10' },
          originalCurrency: { S: 'EUR' },
          category: { S: 'cat-1' },
          type: { S: 'expense' },
          rule: {
            M: { frequency: { S: 'monthly' }, startDate: { S: '2026-01-01' } },
          },
          nextOccurrence: { S: '2026-06-01' },
          status: { S: 'active' },
          userId: { S: 'user-1' },
        },
      ],
    });

    const response = await handler(buildEvent(), {} as never, () => undefined);

    expect(response?.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
    expect(mockSend).not.toHaveBeenCalledWith(expect.any(ScanCommand));
    const command = mockSend.mock.calls[0][0] as QueryCommand;
    expect(command.input.IndexName).toBe('userId-nextOccurrence-index');
    expect(command.input.KeyConditionExpression).toBe('userId = :userId');
    expect(command.input.ExpressionAttributeValues).toEqual({
      ':userId': { S: 'user-1' },
    });
    expect(command.input.ScanIndexForward).toBe(true);
  });

  it('returns only the queried user items as a plain array', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          id: { S: 'rec-a' },
          description: { S: 'A' },
          amount: { N: '10' },
          currency: { S: 'EUR' },
          baseAmount: { N: '10' },
          baseCurrency: { S: 'EUR' },
          originalAmount: { N: '10' },
          originalCurrency: { S: 'EUR' },
          category: { S: 'cat-1' },
          type: { S: 'expense' },
          rule: {
            M: { frequency: { S: 'monthly' }, startDate: { S: '2026-01-01' } },
          },
          nextOccurrence: { S: '2026-06-01' },
          status: { S: 'active' },
          userId: { S: 'user-1' },
        },
        {
          id: { S: 'rec-b' },
          description: { S: 'B' },
          amount: { N: '20' },
          currency: { S: 'EUR' },
          baseAmount: { N: '20' },
          baseCurrency: { S: 'EUR' },
          originalAmount: { N: '20' },
          originalCurrency: { S: 'EUR' },
          category: { S: 'cat-1' },
          type: { S: 'expense' },
          rule: {
            M: { frequency: { S: 'monthly' }, startDate: { S: '2026-01-01' } },
          },
          nextOccurrence: { S: '2026-07-01' },
          status: { S: 'active' },
          userId: { S: 'user-1' },
        },
      ],
    });

    const response = await handler(buildEvent(), {} as never, () => undefined);

    expect(response?.statusCode).toBe(200);
    const body = JSON.parse(response?.body ?? '[]');
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(makeRecurring).toBeDefined();
    expect(body.map((r: RecurringTransaction) => r.id)).toEqual([
      'rec-a',
      'rec-b',
    ]);
  });
});
