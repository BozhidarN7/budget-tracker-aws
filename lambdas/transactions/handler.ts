import { v4 as uuidv4 } from 'uuid';
import { APIGatewayEvent, APIGatewayProxyHandler } from 'aws-lambda';
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  BASE_CURRENCY_CODE,
  buildResponse,
  convertFromBaseCurrency,
  convertToBaseCurrency,
  getUserPreferredCurrency,
  normalizeCurrencyCode,
  toCurrencyNumber,
} from '../../utils';
import type { CurrencyCode, Transaction } from '../../types/budget';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;
const normalizeTransactionInput = async (payload: Record<string, unknown>) => {
  const originalCurrency = normalizeCurrencyCode(payload.currency as string);
  const originalAmount = toCurrencyNumber(payload.amount);

  const { baseAmount, snapshot } = await convertToBaseCurrency(
    originalAmount,
    originalCurrency,
  );

  return {
    ...payload,
    amount: baseAmount,
    currency: BASE_CURRENCY_CODE,
    baseAmount,
    baseCurrency: BASE_CURRENCY_CODE,
    originalAmount,
    originalCurrency,
    exchangeRateSnapshot: snapshot,
  } as Record<string, unknown>;
};

const toTransactionResponse = async (
  item: Record<string, unknown>,
  preferredCurrency: CurrencyCode,
): Promise<Transaction> => {
  const baseAmount = toCurrencyNumber(item.baseAmount ?? item.amount ?? 0);
  const baseCurrency =
    (item.baseCurrency as CurrencyCode) || BASE_CURRENCY_CODE;
  const typedItem = item as unknown as Transaction;
  const originalAmount = typedItem.originalAmount ?? baseAmount;
  const originalCurrency =
    (typedItem.originalCurrency as CurrencyCode) ?? baseCurrency;

  if (preferredCurrency === baseCurrency) {
    return {
      ...typedItem,
      amount: baseAmount,
      currency: baseCurrency,
      baseAmount,
      baseCurrency,
      originalAmount,
      originalCurrency,
      displayAmount: baseAmount,
      displayCurrency: baseCurrency,
      exchangeRateSnapshot: typedItem.exchangeRateSnapshot,
    };
  }

  const { amount: convertedAmount, snapshot } = await convertFromBaseCurrency(
    baseAmount,
    preferredCurrency,
  );

  return {
    ...typedItem,
    amount: convertedAmount,
    currency: preferredCurrency,
    baseAmount,
    baseCurrency,
    originalAmount,
    originalCurrency,
    displayAmount: convertedAmount,
    displayCurrency: preferredCurrency,
    exchangeRateSnapshot: snapshot,
  };
};

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent,
) => {
  const { httpMethod, pathParameters, body, requestContext } = event;
  const id = pathParameters?.id;
  const origin = event.headers.origin || event.headers.Origin;

  const userId = requestContext.authorizer?.claims?.sub;
  if (!userId) {
    return buildResponse(401, { message: 'Unauthorized' }, origin);
  }

  try {
    const preferredCurrencyPromise = getUserPreferredCurrency(userId);

    if (httpMethod === 'GET' && id) {
      const res = await client.send(
        new GetItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ id }),
        }),
      );

      if (!res.Item) {
        return buildResponse(404, { message: 'Transaction not found' }, origin);
      }

      const item = unmarshall(res.Item);
      if (item.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await toTransactionResponse(item, preferredCurrency);

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'GET') {
      const res = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
      const items =
        res.Items?.map((item) => unmarshall(item)).filter(
          (item) => item.userId === userId,
        ) ?? [];

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await Promise.all(
        items.map((item) => toTransactionResponse(item, preferredCurrency)),
      );

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'POST' && body) {
      const payload = JSON.parse(body);
      const normalized = await normalizeTransactionInput(payload);
      const item = {
        id: (payload.id as string) ?? uuidv4(),
        ...normalized,
        userId,
      };

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(item) }),
      );
      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await toTransactionResponse(item, preferredCurrency);

      return buildResponse(201, shaped, origin);
    }

    if (httpMethod === 'PUT' && id && body) {
      const payload = JSON.parse(body);
      const normalized = await normalizeTransactionInput(payload);
      const updated = {
        id,
        ...normalized,
        userId,
      };

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(updated) }),
      );

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await toTransactionResponse(updated, preferredCurrency);

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'DELETE' && id) {
      const res = await client.send(
        new GetItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ id }),
        }),
      );

      if (!res.Item) {
        return buildResponse(404, { message: 'Transaction not found' }, origin);
      }

      const item = unmarshall(res.Item);
      if (item.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      await client.send(
        new DeleteItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ id }),
        }),
      );

      return buildResponse(200, { message: 'Deleted' }, origin);
    }

    return buildResponse(
      400,
      {
        message: 'Unsupported method or missing data.',
      },
      origin,
    );
  } catch (err) {
    return buildResponse(500, { error: (err as Error).message }, origin);
  }
};
