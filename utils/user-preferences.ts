import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { CurrencyCode, UserPreference } from '../types/budget';

const TABLE_NAME = process.env.USER_TABLE_NAME;
const BASE_CURRENCY = (process.env.BASE_CURRENCY as CurrencyCode) || 'EUR';

const client = new DynamoDBClient({});

export const getUserPreference = async (
  userId: string,
): Promise<UserPreference> => {
  if (!TABLE_NAME) {
    const fallback: UserPreference = {
      userId,
      preferredCurrency: BASE_CURRENCY,
      updatedAt: new Date().toISOString(),
    };
    return fallback;
  }

  const res = await client.send(
    new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ userId }),
    }),
  );

  if (!res.Item) {
    return {
      userId,
      preferredCurrency: BASE_CURRENCY,
      updatedAt: new Date().toISOString(),
    };
  }

  const record = unmarshall(res.Item) as UserPreference;
  return {
    userId,
    preferredCurrency:
      (record.preferredCurrency as CurrencyCode) || BASE_CURRENCY,
    updatedAt: record.updatedAt,
  };
};

export const getUserPreferredCurrency = async (
  userId: string,
): Promise<CurrencyCode> => {
  const pref = await getUserPreference(userId);
  return pref.preferredCurrency || BASE_CURRENCY;
};

export const saveUserPreference = async (
  userId: string,
  preferredCurrency: CurrencyCode,
): Promise<UserPreference> => {
  if (!TABLE_NAME) {
    throw new Error('USER_TABLE_NAME is not configured');
  }

  const preference: UserPreference = {
    userId,
    preferredCurrency,
    updatedAt: new Date().toISOString(),
  };

  await client.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(preference),
    }),
  );

  return preference;
};
