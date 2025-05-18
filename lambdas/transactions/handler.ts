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

  try {
    if (httpMethod === 'GET' && id) {
      const res = await client.send(
        new GetItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );
      return buildResponse(200, unmarshall(res.Item!));
    }

    if (httpMethod === 'GET') {
      const res = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
      return buildResponse(
        200,
        res.Items?.map((item) => unmarshall(item)),
      );
    }

    if (httpMethod === 'POST' && body) {
      let item = JSON.parse(body);
      item = {
        id: item.id ?? uuidv4(),
        ...item,
      };

      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(item) }),
      );
      return buildResponse(201, item);
    }

    if (httpMethod === 'PUT' && id && body) {
      const updated = JSON.parse(body);
      updated.id = id;
      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(updated) }),
      );
      return buildResponse(200, updated);
    }

    if (httpMethod === 'DELETE' && id) {
      await client.send(
        new DeleteItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );
      return buildResponse(200, { message: 'Deleted' });
    }

    return buildResponse(400, {
      message: 'Unsupported method or missing data.',
    });
  } catch (err) {
    return buildResponse(500, { error: (err as Error).message });
  }
};
