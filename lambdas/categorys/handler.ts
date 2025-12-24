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
import type { Category, CurrencyCode } from '../../types/budget';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;
const normalizeMonthlyData = async (
  monthlyData: Category['monthlyData'],
  currency: CurrencyCode,
): Promise<Category['monthlyData']> => {
  const entries = await Promise.all(
    Object.entries(monthlyData).map(async ([month, value]) => {
      const { baseAmount: limit } = await convertToBaseCurrency(
        toCurrencyNumber(value.limit),
        currency,
      );
      const { baseAmount: spent } = await convertToBaseCurrency(
        toCurrencyNumber(value.spent),
        currency,
      );

      return [month, { limit, spent }];
    }),
  );

  return Object.fromEntries(entries);
};

const shapeCategoryResponse = async (
  rawCategory: Category,
  preferredCurrency: CurrencyCode,
) => {
  const baseCurrency = rawCategory.baseCurrency || BASE_CURRENCY_CODE;
  const monthlyDataEntries = await Promise.all(
    Object.entries(rawCategory.monthlyData ?? {}).map(
      async ([month, value]) => {
        const limitBase = toCurrencyNumber(value.limit);
        const spentBase = toCurrencyNumber(value.spent);

        if (preferredCurrency === baseCurrency) {
          return [
            month,
            {
              ...value,
              baseLimit: limitBase,
              baseSpent: spentBase,
              limit: limitBase,
              spent: spentBase,
              currency: preferredCurrency,
            },
          ];
        }

        const [limitConverted, spentConverted] = await Promise.all([
          convertFromBaseCurrency(limitBase, preferredCurrency),
          convertFromBaseCurrency(spentBase, preferredCurrency),
        ]);

        return [
          month,
          {
            ...value,
            baseLimit: limitBase,
            baseSpent: spentBase,
            limit: limitConverted.amount,
            spent: spentConverted.amount,
            currency: preferredCurrency,
          },
        ];
      },
    ),
  );

  return {
    ...rawCategory,
    currency: preferredCurrency,
    baseCurrency,
    monthlyData: Object.fromEntries(monthlyDataEntries),
  } as Category;
};

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent,
) => {
  const { httpMethod, pathParameters, body } = event;
  const id = pathParameters?.id;
  const origin = event.headers.origin || event.headers.Origin;

  const userId = event.requestContext.authorizer?.claims?.sub;
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
        return buildResponse(404, { message: 'Category not found' }, origin);
      }

      const item = unmarshall(res.Item) as Category;
      if (item.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await shapeCategoryResponse(item, preferredCurrency);

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'GET') {
      const res = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
      const filteredItems =
        res.Items?.map((item) => unmarshall(item) as Category).filter(
          (item) => item.userId === userId,
        ) ?? [];

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await Promise.all(
        filteredItems.map((item) =>
          shapeCategoryResponse(item, preferredCurrency),
        ),
      );

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'POST' && body) {
      const payload = JSON.parse(body);
      const categoryId = payload.id ?? uuidv4();
      const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
      const currency = normalizeCurrencyCode(payload.currency);
      const monthlyPayload =
        payload.monthlyData && typeof payload.monthlyData === 'object'
          ? (payload.monthlyData as Category['monthlyData'])
          : {
              [month]: {
                limit: payload.limit,
                spent: payload.spent ?? 0,
              },
            };

      const monthlyData = await normalizeMonthlyData(monthlyPayload, currency);

      const newCategory: Category = {
        id: categoryId,
        userId,
        name: payload.name,
        color: payload.color,
        type: payload.type,
        currency,
        baseCurrency: BASE_CURRENCY_CODE,
        monthlyData,
      };

      await client.send(
        new PutItemCommand({
          TableName: TABLE_NAME,
          Item: marshall(newCategory),
        }),
      );

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await shapeCategoryResponse(
        newCategory,
        preferredCurrency,
      );

      return buildResponse(201, shaped, origin);
    }

    if (httpMethod === 'PUT' && id && body) {
      const payload = JSON.parse(body);

      const { Item } = await client.send(
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      if (!Item) {
        return buildResponse(404, { message: 'Category not found' }, origin);
      }

      const existing = unmarshall(Item) as Category;
      if (existing.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const incomingMonthlyData =
        (payload.monthlyData as Category['monthlyData']) ?? {};
      const currency = normalizeCurrencyCode(
        (payload.currency as string) || existing.currency,
      );

      const normalizedIncoming = Object.keys(incomingMonthlyData).length
        ? await normalizeMonthlyData(incomingMonthlyData, currency)
        : {};

      const mergedMonthlyData: Category['monthlyData'] = {
        ...existing.monthlyData,
        ...normalizedIncoming,
      };

      const updated: Category = {
        ...existing,
        name: payload.name ?? existing.name,
        color: payload.color ?? existing.color,
        type: payload.type ?? existing.type,
        currency,
        baseCurrency: BASE_CURRENCY_CODE,
        monthlyData: mergedMonthlyData,
      };

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(updated) }),
      );

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await shapeCategoryResponse(updated, preferredCurrency);

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'DELETE' && id) {
      const { Item } = await client.send(
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      if (!Item) {
        return buildResponse(404, { message: 'Category not found' }, origin);
      }

      const category = unmarshall(Item);
      if (category.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      await client.send(
        new DeleteItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
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
