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
  computeNextOccurrence,
  convertFromBaseCurrency,
  convertToBaseCurrency,
  createRateContext,
  getStatusForOccurrence,
  getUserPreferredCurrency,
  normalizeCurrencyCode,
  normalizeRecurringRule,
  toCurrencyNumber,
  validateRecurringRule,
} from '../../utils';
import type { RateContext } from '../../utils';
import type {
  CurrencyCode,
  RecurringRule,
  RecurringStatus,
  RecurringTransaction,
} from '../../types/budget';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

const normalizeRecurringInput = async (
  payload: Record<string, unknown>,
  rateContext: RateContext,
) => {
  const originalCurrency = normalizeCurrencyCode(payload.currency as string);
  const originalAmount = toCurrencyNumber(payload.amount);

  const { baseAmount, snapshot } = await convertToBaseCurrency(
    originalAmount,
    originalCurrency,
    rateContext,
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

const parseRecurringRule = (rule: unknown): RecurringRule => {
  if (!rule || typeof rule !== 'object') {
    throw new Error('Missing recurrence rule');
  }

  const rawRule = rule as RecurringRule;
  validateRecurringRule(rawRule);
  return normalizeRecurringRule(rawRule);
};

const toRecurringResponse = async (
  item: Record<string, unknown>,
  preferredCurrency: CurrencyCode,
  rateContext: RateContext,
): Promise<RecurringTransaction> => {
  const baseAmount = toCurrencyNumber(item.baseAmount ?? item.amount ?? 0);
  const baseCurrency =
    (item.baseCurrency as CurrencyCode) || BASE_CURRENCY_CODE;
  const typedItem = item as unknown as RecurringTransaction;
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
    rateContext,
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

const normalizeStatus = (
  status: unknown,
  nextOccurrence: string,
  endDate?: string,
): RecurringStatus => {
  if (status === 'paused') {
    return 'paused';
  }
  if (status === 'completed') {
    return 'completed';
  }
  return getStatusForOccurrence(nextOccurrence, endDate);
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

  const rateContext = createRateContext();

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
        return buildResponse(
          404,
          { message: 'Recurring transaction not found' },
          origin,
        );
      }

      const item = unmarshall(res.Item);
      if (item.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await toRecurringResponse(
        item,
        preferredCurrency,
        rateContext,
      );

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
        items.map((item) =>
          toRecurringResponse(item, preferredCurrency, rateContext),
        ),
      );

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'POST' && body) {
      const payload = JSON.parse(body) as Record<string, unknown>;
      const rule = parseRecurringRule(payload.rule);
      const nextOccurrence = computeNextOccurrence(rule);
      const status = normalizeStatus(
        payload.status,
        nextOccurrence,
        rule.endDate,
      );
      const normalized = await normalizeRecurringInput(payload, rateContext);
      const item: RecurringTransaction = {
        id: (payload.id as string) ?? uuidv4(),
        ...normalized,
        rule,
        nextOccurrence,
        status,
        userId,
      } as RecurringTransaction;

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(item) }),
      );

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await toRecurringResponse(
        item as unknown as Record<string, unknown>,
        preferredCurrency,
        rateContext,
      );

      return buildResponse(201, shaped, origin);
    }

    if (httpMethod === 'PUT' && id && body) {
      const existing = await client.send(
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      if (!existing.Item) {
        return buildResponse(
          404,
          { message: 'Recurring transaction not found' },
          origin,
        );
      }

      const stored = unmarshall(existing.Item) as RecurringTransaction;
      if (stored.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const payload = JSON.parse(body) as Record<string, unknown>;
      const rule = payload.rule
        ? parseRecurringRule(payload.rule)
        : stored.rule;
      const nextOccurrence = computeNextOccurrence(rule);
      const status = normalizeStatus(
        payload.status ?? stored.status,
        nextOccurrence,
        rule.endDate,
      );
      const normalized = await normalizeRecurringInput(
        {
          ...stored,
          ...payload,
          rule,
          nextOccurrence,
          status,
        } as Record<string, unknown>,
        rateContext,
      );
      const updated: RecurringTransaction = {
        ...stored,
        ...normalized,
        id,
        rule,
        nextOccurrence,
        status,
        userId,
      } as RecurringTransaction;

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(updated) }),
      );

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await toRecurringResponse(
        updated as unknown as Record<string, unknown>,
        preferredCurrency,
        rateContext,
      );

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'DELETE' && id) {
      const res = await client.send(
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      if (!res.Item) {
        return buildResponse(
          404,
          { message: 'Recurring transaction not found' },
          origin,
        );
      }

      const item = unmarshall(res.Item);
      if (item.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      await client.send(
        new DeleteItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      return buildResponse(200, { message: 'Deleted' }, origin);
    }

    return buildResponse(
      400,
      { message: 'Unsupported method or missing data.' },
      origin,
    );
  } catch (err) {
    return buildResponse(500, { error: (err as Error).message }, origin);
  }
};
