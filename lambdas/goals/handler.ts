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
import type { CurrencyCode, Goal } from '../../types/budget';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;
const normalizeGoalAmounts = async (value: number, currency: CurrencyCode) => {
  const { baseAmount } = await convertToBaseCurrency(value, currency);
  return baseAmount;
};

const shapeGoalResponse = async (
  goal: Goal,
  preferredCurrency: CurrencyCode,
) => {
  const baseCurrency = goal.baseCurrency || BASE_CURRENCY_CODE;

  if (preferredCurrency === baseCurrency) {
    return {
      ...goal,
      currency: baseCurrency,
      displayTarget: goal.target,
      displayCurrent: goal.current,
    };
  }

  const [targetConversion, currentConversion] = await Promise.all([
    convertFromBaseCurrency(goal.target ?? 0, preferredCurrency),
    convertFromBaseCurrency(goal.current ?? 0, preferredCurrency),
  ]);

  return {
    ...goal,
    currency: preferredCurrency,
    displayTarget: targetConversion.amount,
    displayCurrent: currentConversion.amount,
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
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      if (!res.Item) {
        return buildResponse(404, { message: 'Goal not found' }, origin);
      }

      const item = unmarshall(res.Item) as Goal;
      if (item.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await shapeGoalResponse(item, preferredCurrency);

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'GET') {
      const res = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
      const items =
        res.Items?.map((item) => unmarshall(item) as Goal).filter(
          (item) => item.userId === userId,
        ) ?? [];

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await Promise.all(
        items.map((item) => shapeGoalResponse(item, preferredCurrency)),
      );

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'POST' && body) {
      const payload = JSON.parse(body);
      const currency = normalizeCurrencyCode(payload.currency);
      const target = await normalizeGoalAmounts(
        toCurrencyNumber(payload.target),
        currency,
      );
      const current = await normalizeGoalAmounts(
        toCurrencyNumber(payload.current ?? 0),
        currency,
      );

      const goal: Goal = {
        id: payload.id ?? uuidv4(),
        userId,
        name: payload.name,
        target,
        current,
        targetDate: payload.targetDate,
        description: payload.description,
        currency,
        baseCurrency: BASE_CURRENCY_CODE,
      };

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(goal) }),
      );

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await shapeGoalResponse(goal, preferredCurrency);

      return buildResponse(201, shaped, origin);
    }

    if (httpMethod === 'PUT' && id && body) {
      const existing = await client.send(
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      if (!existing.Item) {
        return buildResponse(404, { message: 'Goal not found' }, origin);
      }

      const stored = unmarshall(existing.Item) as Goal;
      if (stored.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const payload = JSON.parse(body);
      const currency = normalizeCurrencyCode(
        (payload.currency as string) || stored.currency,
      );

      const updatedTarget =
        payload.target !== undefined
          ? await normalizeGoalAmounts(
              toCurrencyNumber(payload.target),
              currency,
            )
          : stored.target;
      const updatedCurrent =
        payload.current !== undefined
          ? await normalizeGoalAmounts(
              toCurrencyNumber(payload.current),
              currency,
            )
          : stored.current;

      const updated: Goal = {
        ...stored,
        name: payload.name ?? stored.name,
        description: payload.description ?? stored.description,
        targetDate: payload.targetDate ?? stored.targetDate,
        target: updatedTarget,
        current: updatedCurrent,
        currency,
        baseCurrency: BASE_CURRENCY_CODE,
      };

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(updated) }),
      );

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await shapeGoalResponse(updated, preferredCurrency);

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'DELETE' && id) {
      const existing = await client.send(
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      if (!existing.Item) {
        return buildResponse(404, { message: 'Goal not found' }, origin);
      }

      const item = unmarshall(existing.Item);
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
