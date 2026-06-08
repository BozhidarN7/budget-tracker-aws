process.env.TABLE_NAME = 'test-transactions';

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

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'generated-id'),
}));

jest.mock('../utils', () => ({
  BASE_CURRENCY_CODE: 'EUR',
  buildResponse: jest.requireActual('../utils/build-response').default,
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
  getUserPreferredCurrency: jest.fn(async () => 'EUR'),
  normalizeCurrencyCode: jest.fn((currency: string) => currency),
  toCurrencyNumber: jest.fn((value: unknown) => Number(value)),
}));

import {
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { APIGatewayEvent } from 'aws-lambda';
import { handler } from '../lambdas/transactions/handler';

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
    path: '/transactions',
    requestId: 'request-id',
    requestTimeEpoch: 0,
    resourceId: 'resource-id',
    resourcePath: '/transactions',
    stage: 'dev',
  };

  return {
    body: null,
    headers: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path: '/transactions',
    pathParameters: null,
    queryStringParameters: null,
    requestContext: {
      ...baseRequestContext,
      ...(overrides.requestContext ?? {}),
    },
    resource: '/transactions',
    stageVariables: null,
    ...overrides,
  } as APIGatewayEvent;
};

const parseBody = (response: { body: string }) => JSON.parse(response.body);

describe('transactions handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('queries the user GSI and returns paginated newest-first results', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: {
        id: { S: 'txn-1' },
        userId: { S: 'user-1' },
        dateKey: { S: '2026-05-01#txn-1' },
      },
    });

    const response = await handler(
      buildEvent({
        queryStringParameters: { limit: '10' },
      }),
      {} as never,
      () => undefined,
    );

    expect(response?.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
    const command = mockSend.mock.calls[0][0] as QueryCommand;
    expect(command.input.IndexName).toBe('userId-dateKey-index');
    expect(command.input.ScanIndexForward).toBe(false);
    expect(command.input.Limit).toBe(10);
    expect(parseBody(response as { body: string })).toEqual({
      items: [],
      nextCursor: expect.any(String),
    });
  });

  it('rejects an invalid cursor', async () => {
    const response = await handler(
      buildEvent({
        queryStringParameters: { cursor: 'not-valid' },
      }),
      {} as never,
      () => undefined,
    );

    expect(response?.statusCode).toBe(400);
    expect(parseBody(response as { body: string })).toEqual({
      message: 'Invalid cursor',
    });
  });

  it('writes dateKey on create', async () => {
    mockSend.mockResolvedValueOnce({});

    const response = await handler(
      buildEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          description: 'Coffee',
          amount: 5,
          currency: 'EUR',
          date: '2026-05-01',
          category: 'food',
          type: 'expense',
        }),
      }),
      {} as never,
      () => undefined,
    );

    expect(response?.statusCode).toBe(201);
    const command = mockSend.mock.calls[0][0] as PutItemCommand;
    expect(unmarshall(command.input.Item ?? {})).toMatchObject({
      id: 'generated-id',
      date: '2026-05-01',
      dateKey: '2026-05-01#generated-id',
      userId: 'user-1',
    });
  });

  it('returns 404 on update when transaction is missing', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const response = await handler(
      buildEvent({
        httpMethod: 'PUT',
        pathParameters: { id: 'txn-1' },
        body: JSON.stringify({
          description: 'Updated',
          amount: 10,
          currency: 'EUR',
          date: '2026-05-02',
          category: 'food',
          type: 'expense',
        }),
      }),
      {} as never,
      () => undefined,
    );

    expect(response?.statusCode).toBe(404);
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetItemCommand));
  });

  it('returns 403 on update when transaction belongs to another user', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        id: { S: 'txn-1' },
        userId: { S: 'user-2' },
        date: { S: '2026-05-01' },
      },
    });

    const response = await handler(
      buildEvent({
        httpMethod: 'PUT',
        pathParameters: { id: 'txn-1' },
        body: JSON.stringify({
          description: 'Updated',
          amount: 10,
          currency: 'EUR',
          date: '2026-05-02',
          category: 'food',
          type: 'expense',
        }),
      }),
      {} as never,
      () => undefined,
    );

    expect(response?.statusCode).toBe(403);
  });

  it('recomputes dateKey on update', async () => {
    mockSend
      .mockResolvedValueOnce({
        Item: {
          id: { S: 'txn-1' },
          description: { S: 'Old' },
          amount: { N: '5' },
          baseAmount: { N: '5' },
          currency: { S: 'EUR' },
          baseCurrency: { S: 'EUR' },
          originalAmount: { N: '5' },
          originalCurrency: { S: 'EUR' },
          date: { S: '2026-05-01' },
          dateKey: { S: '2026-05-01#txn-1' },
          category: { S: 'food' },
          type: { S: 'expense' },
          userId: { S: 'user-1' },
        },
      })
      .mockResolvedValueOnce({});

    const response = await handler(
      buildEvent({
        httpMethod: 'PUT',
        pathParameters: { id: 'txn-1' },
        body: JSON.stringify({
          description: 'Updated',
          amount: 10,
          currency: 'EUR',
          date: '2026-05-03',
          category: 'food',
          type: 'expense',
        }),
      }),
      {} as never,
      () => undefined,
    );

    expect(response?.statusCode).toBe(200);
    const command = mockSend.mock.calls[1][0] as PutItemCommand;
    expect(unmarshall(command.input.Item ?? {})).toMatchObject({
      id: 'txn-1',
      date: '2026-05-03',
      dateKey: '2026-05-03#txn-1',
      userId: 'user-1',
    });
  });
});
