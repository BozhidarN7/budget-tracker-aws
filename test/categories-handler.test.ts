process.env.TABLE_NAME = 'test-categories';

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

import { QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import type { APIGatewayEvent } from 'aws-lambda';
import { handler } from '../lambdas/categorys/handler';
import type { Category } from '../types/budget';

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
    path: '/categories',
    requestId: 'request-id',
    requestTimeEpoch: 0,
    resourceId: 'resource-id',
    resourcePath: '/categories',
    stage: 'dev',
  };
  return {
    body: null,
    headers: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path: '/categories',
    pathParameters: null,
    queryStringParameters: null,
    requestContext: {
      ...baseRequestContext,
      ...(overrides.requestContext ?? {}),
    },
    resource: '/categories',
    stageVariables: null,
    ...overrides,
  } as APIGatewayEvent;
};

describe('categories handler GET list', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('queries the user GSI instead of scanning', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          id: { S: 'cat-1' },
          userId: { S: 'user-1' },
          name: { S: 'Groceries' },
          color: { S: '#000' },
          type: { S: 'expense' },
          currency: { S: 'EUR' },
          baseCurrency: { S: 'EUR' },
          monthlyData: { M: {} },
        },
      ],
    });

    const response = await handler(buildEvent(), {} as never, () => undefined);

    expect(response?.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
    expect(mockSend).not.toHaveBeenCalledWith(expect.any(ScanCommand));
    const command = mockSend.mock.calls[0][0] as QueryCommand;
    expect(command.input.IndexName).toBe('userId-name-index');
    expect(command.input.KeyConditionExpression).toBe('userId = :userId');
    expect(command.input.ExpressionAttributeValues).toEqual({
      ':userId': { S: 'user-1' },
    });
    expect(JSON.parse(response?.body ?? '[]')).toHaveLength(1);
  });

  it('returns only the queried user items as a plain array', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          id: { S: 'cat-a' },
          userId: { S: 'user-1' },
          name: { S: 'A' },
          color: { S: '#000' },
          type: { S: 'expense' },
          currency: { S: 'EUR' },
          baseCurrency: { S: 'EUR' },
          monthlyData: { M: {} },
        },
        {
          id: { S: 'cat-b' },
          userId: { S: 'user-1' },
          name: { S: 'B' },
          color: { S: '#000' },
          type: { S: 'expense' },
          currency: { S: 'EUR' },
          baseCurrency: { S: 'EUR' },
          monthlyData: { M: {} },
        },
      ],
    });

    const response = await handler(buildEvent(), {} as never, () => undefined);

    expect(response?.statusCode).toBe(200);
    const body = JSON.parse(response?.body ?? '[]');
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body.map((c: Category) => c.id)).toEqual(['cat-a', 'cat-b']);
  });
});
