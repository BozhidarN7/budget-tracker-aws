import { APIGatewayEvent, APIGatewayProxyHandler } from 'aws-lambda';
import { buildResponse } from '../../utils';
import { materializeDueForUser } from '../../utils/recurring-materializer';

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayEvent,
) => {
  const origin = event.headers.origin || event.headers.Origin;
  const userId = event.requestContext.authorizer?.claims?.sub;
  if (!userId) {
    return buildResponse(401, { message: 'Unauthorized' }, origin);
  }

  try {
    const summary = await materializeDueForUser(userId);
    return buildResponse(200, summary, origin);
  } catch (err) {
    return buildResponse(500, { error: (err as Error).message }, origin);
  }
};
