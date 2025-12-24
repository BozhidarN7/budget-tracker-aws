import { APIGatewayEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { buildResponse, isSupportedCurrency } from '../../utils';
import {
  getUserPreference,
  saveUserPreference,
} from '../../utils/user-preferences';
import { getSupportedCurrencies } from '../../utils/currency';

const supportedCurrencies = getSupportedCurrencies();

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent,
) => {
  const { httpMethod, pathParameters, body, requestContext } = event;
  const origin = event.headers.origin || event.headers.Origin;

  const userId = requestContext.authorizer?.claims?.sub;
  if (!userId) {
    return buildResponse(401, { message: 'Unauthorized' }, origin);
  }

  try {
    if (httpMethod === 'GET') {
      const targetUserId = pathParameters?.id ?? userId;
      if (targetUserId !== userId) {
        return buildResponse(403, { message: 'Forbidden' }, origin);
      }

      const preference = await getUserPreference(targetUserId);
      return buildResponse(200, { ...preference, supportedCurrencies }, origin);
    }

    if ((httpMethod === 'POST' || httpMethod === 'PUT') && body) {
      const payload = JSON.parse(body) as {
        preferredCurrency?: string;
      };

      if (!isSupportedCurrency(payload.preferredCurrency)) {
        return buildResponse(
          400,
          {
            message: 'Unsupported currency',
            supportedCurrencies,
          },
          origin,
        );
      }

      const updated = await saveUserPreference(
        userId,
        payload.preferredCurrency,
      );

      return buildResponse(200, { ...updated, supportedCurrencies }, origin);
    }

    return buildResponse(
      400,
      { message: 'Unsupported method or missing data.' },
      origin,
    );
  } catch (error) {
    return buildResponse(500, { error: (error as Error).message }, origin);
  }
};
