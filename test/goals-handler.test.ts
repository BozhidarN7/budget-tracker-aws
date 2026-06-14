process.env.TABLE_NAME = 'test-goals';

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
import { handler } from '../lambdas/goals/handler';
import type { Goal } from '../types/budget';

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
    path: '/goals',
    requestId: 'request-id',
    requestTimeEpoch: 0,
    resourceId: 'resource-id',
    resourcePath: '/goals',
    stage: 'dev',
  };
  return {
    body: null,
    headers: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    path: '/goals',
    pathParameters: null,
    queryStringParameters: null,
    requestContext: {
      ...baseRequestContext,
      ...(overrides.requestContext ?? {}),
    },
    resource: '/goals',
    stageVariables: null,
    ...overrides,
  } as APIGatewayEvent;
};

describe('goals handler GET list', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('queries the user GSI instead of scanning', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          id: { S: 'goal-1' },
          userId: { S: 'user-1' },
          name: { S: 'Trip' },
          target: { N: '1000' },
          current: { N: '0' },
          targetDate: { S: '2027-01-01' },
          description: { S: '' },
          currency: { S: 'EUR' },
          baseCurrency: { S: 'EUR' },
        },
      ],
    });

    const response = await handler(buildEvent(), {} as never, () => undefined);

    expect(response?.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledWith(expect.any(QueryCommand));
    expect(mockSend).not.toHaveBeenCalledWith(expect.any(ScanCommand));
    const command = mockSend.mock.calls[0][0] as QueryCommand;
    expect(command.input.IndexName).toBe('userId-targetDate-index');
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
          id: { S: 'goal-a' },
          userId: { S: 'user-1' },
          name: { S: 'A' },
          target: { N: '100' },
          current: { N: '0' },
          targetDate: { S: '2026-12-01' },
          description: { S: '' },
          currency: { S: 'EUR' },
          baseCurrency: { S: 'EUR' },
        },
        {
          id: { S: 'goal-b' },
          userId: { S: 'user-1' },
          name: { S: 'B' },
          target: { N: '200' },
          current: { N: '50' },
          targetDate: { S: '2027-06-01' },
          description: { S: '' },
          currency: { S: 'EUR' },
          baseCurrency: { S: 'EUR' },
        },
      ],
    });

    const response = await handler(buildEvent(), {} as never, () => undefined);

    expect(response?.statusCode).toBe(200);
    const body = JSON.parse(response?.body ?? '[]');
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body.map((g: Goal) => g.id)).toEqual(['goal-a', 'goal-b']);
  });
});
