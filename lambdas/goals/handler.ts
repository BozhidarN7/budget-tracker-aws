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
      return { statusCode: 200, body: JSON.stringify(unmarshall(res.Item!)) };
    }

    if (httpMethod === 'GET') {
      const res = await client.send(new ScanCommand({ TableName: TABLE_NAME }));
      return {
        statusCode: 200,
        body: JSON.stringify(res.Items?.map((item) => unmarshall(item))),
      };
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
      return { statusCode: 201, body: JSON.stringify({ message: 'Created' }) };
    }

    if (httpMethod === 'PUT' && id && body) {
      const updated = JSON.parse(body);
      updated.id = id;
      await client.send(
        new PutItemCommand({ TableName: TABLE_NAME, Item: marshall(updated) }),
      );
      return { statusCode: 200, body: JSON.stringify({ message: 'Updated' }) };
    }

    if (httpMethod === 'DELETE' && id) {
      await client.send(
        new DeleteItemCommand({ TableName: TABLE_NAME, Key: marshall({ id }) }),
      );
      return { statusCode: 200, body: JSON.stringify({ message: 'Deleted' }) };
    }

    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'Unsupported method or missing data.' }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: (err as Error).message }),
    };
  }
};
