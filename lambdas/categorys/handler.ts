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
import { buildResponse } from '../../utils';

const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

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
    if (httpMethod === 'GET' && id) {
      const res = await client.send(
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      if (!res.Item) {
        return buildResponse(404, { message: 'Category not found' }, origin);
      }

      const item = unmarshall(res.Item);
      if (item.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      return buildResponse(200, item, origin);
    }

    if (httpMethod === 'GET') {
      const res = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
      const filteredItems =
        res.Items?.map((item) => unmarshall(item)).filter(
          (item) => item.userId === userId,
        ) ?? [];

      return buildResponse(200, filteredItems, origin);
    }

    if (httpMethod === 'POST' && body) {
      const item = JSON.parse(body);
      const id = item.id ?? uuidv4();
      const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

      const newCategory = {
        id,
        userId,
        name: item.name,
        color: item.color,
        type: item.type,
        monthlyData:
          item.monthlyData && typeof item.monthlyData === 'object'
            ? item.monthlyData
            : {
                [month]: {
                  limit: item.limit,
                  spent: item.spent ?? 0,
                },
              },
      };

      await client.send(
        new PutItemCommand({
          TableName: TABLE_NAME,
          Item: marshall(newCategory),
        }),
      );

      return buildResponse(201, newCategory, origin);
    }

    if (httpMethod === 'PUT' && id && body) {
      const item = JSON.parse(body);

      const { Item } = await client.send(
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );

      if (!Item) {
        return buildResponse(404, { message: 'Category not found' }, origin);
      }

      const existing = unmarshall(Item);
      if (existing.userId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const existingMonthlyData = existing.monthlyData ?? {};
      const incomingMonthlyData = item.monthlyData ?? {};

      const mergedMonthlyData: Record<
        string,
        { limit: number; spent: number }
      > = {
        ...existingMonthlyData,
        ...(
          Object.entries(incomingMonthlyData) as [
            string,
            Record<string, { limit: number; spent: number }>,
          ][]
        ).reduce(
          (acc, [month, value]) => {
            acc[month] = {
              limit: Number(value.limit),
              spent: Number(value.spent),
            };
            return acc;
          },
          {} as Record<string, { limit: number; spent: number }>,
        ),
      };

      const updated = {
        ...existing,
        name: item.name ?? existing.name,
        color: item.color ?? existing.color,
        type: item.type ?? existing.type,
        monthlyData: mergedMonthlyData,
      };

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(updated) }),
      );

      return buildResponse(200, updated, origin);
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
