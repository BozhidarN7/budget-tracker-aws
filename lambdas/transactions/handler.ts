import { v4 as uuidv4 } from 'uuid';
import { APIGatewayEvent, APIGatewayProxyHandler } from 'aws-lambda';
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  buildResponse,
  createRateContext,
  getUserPreferredCurrency,
} from '../../utils';
import type { PaginatedTransactionsResponse } from '../../types/budget';
import {
  decodeCursor,
  encodeCursor,
  normalizeTransactionInput,
  parseLimit,
  toTransactionResponse,
  withTransactionIndexFields,
} from './helpers';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;
const TRANSACTIONS_BY_USER_INDEX = 'userId-dateKey-index';

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
        return buildResponse(404, { message: 'Transaction not found' }, origin);
      }

      const item = unmarshall(res.Item);
      if (item.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await toTransactionResponse(
        item,
        preferredCurrency,
        rateContext,
      );

      return buildResponse(200, shaped, origin);
    }

    if (httpMethod === 'GET') {
      let limit: number;
      let exclusiveStartKey: Record<string, unknown> | undefined;

      try {
        limit = parseLimit(event.queryStringParameters?.limit);
        exclusiveStartKey = decodeCursor(event.queryStringParameters?.cursor);
      } catch (error) {
        return buildResponse(
          400,
          { message: (error as Error).message },
          origin,
        );
      }

      const res = await client.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          IndexName: TRANSACTIONS_BY_USER_INDEX,
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: marshall({ ':userId': userId }),
          ExclusiveStartKey: exclusiveStartKey
            ? marshall(exclusiveStartKey)
            : undefined,
          Limit: limit,
          ScanIndexForward: false,
        }),
      );
      const items = res.Items?.map((item) => unmarshall(item)) ?? [];

      const preferredCurrency = await preferredCurrencyPromise;
      const shapedItems = await Promise.all(
        items.map((item) =>
          toTransactionResponse(item, preferredCurrency, rateContext),
        ),
      );
      const response: PaginatedTransactionsResponse = {
        items: shapedItems,
      };

      if (res.LastEvaluatedKey) {
        response.nextCursor = encodeCursor(unmarshall(res.LastEvaluatedKey));
      }

      return buildResponse(200, response, origin);
    }

    if (httpMethod === 'POST' && body) {
      const payload = JSON.parse(body);
      const normalized = await normalizeTransactionInput(payload, rateContext);
      const item = withTransactionIndexFields({
        id: (payload.id as string) ?? uuidv4(),
        ...normalized,
        userId,
      });

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(item) }),
      );
      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await toTransactionResponse(
        item,
        preferredCurrency,
        rateContext,
      );

      return buildResponse(201, shaped, origin);
    }

    if (httpMethod === 'PUT' && id && body) {
      const existing = await client.send(
        new GetItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ id }),
        }),
      );

      if (!existing.Item) {
        return buildResponse(404, { message: 'Transaction not found' }, origin);
      }

      const existingItem = unmarshall(existing.Item);
      if (existingItem.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const payload = JSON.parse(body);
      const normalized = await normalizeTransactionInput(payload, rateContext);
      const updated = withTransactionIndexFields({
        ...existingItem,
        id,
        ...normalized,
        userId,
      });

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(updated) }),
      );

      const preferredCurrency = await preferredCurrencyPromise;
      const shaped = await toTransactionResponse(
        updated,
        preferredCurrency,
        rateContext,
      );

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
