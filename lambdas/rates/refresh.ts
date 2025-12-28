import { APIGatewayProxyHandler, ScheduledHandler } from 'aws-lambda';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  buildResponse,
  getLastRefreshEpoch,
  refreshAllRates,
} from '../../utils';

const cloudWatchClient = new CloudWatchClient({});
const metricNamespace = 'BudgetTracker/Rates';
const metricName = 'HoursSinceRefresh';
const allowedGroupsEnv =
  process.env.RATES_REFRESH_ALLOWED_GROUP || 'rates-admins';
const allowedGroups = allowedGroupsEnv
  .split(',')
  .map((group) => group.trim())
  .filter(Boolean);

const publishMetric = async (epoch: number | null) => {
  if (!epoch) {
    return;
  }
  const hoursSince = Number(
    ((Date.now() - epoch) / (1000 * 60 * 60)).toFixed(2),
  );
  await cloudWatchClient.send(
    new PutMetricDataCommand({
      Namespace: metricNamespace,
      MetricData: [
        {
          MetricName: metricName,
          Timestamp: new Date(),
          Unit: 'None',
          Value: hoursSince,
        },
      ],
    }),
  );
};

export const scheduledHandler: ScheduledHandler = async () => {
  try {
    const result = await refreshAllRates();
    await publishMetric(result.lastRefreshEpoch);
  } catch (error) {
    const lastEpoch = await getLastRefreshEpoch();
    await publishMetric(lastEpoch);
    console.error('Scheduled refresh failed', error);
    throw error;
  }
};

const callerAllowed = (groupsClaim?: string) => {
  if (!allowedGroups.length) {
    return true;
  }
  if (!groupsClaim) {
    return false;
  }
  const callerGroups = groupsClaim.split(',').map((group) => group.trim());
  return callerGroups.some((group) => allowedGroups.includes(group));
};

export const manualHandler: APIGatewayProxyHandler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin;
  const groupsClaim =
    event.requestContext.authorizer?.claims?.['cognito:groups'];

  if (!callerAllowed(groupsClaim as string | undefined)) {
    return buildResponse(403, { message: 'Forbidden' }, origin);
  }

  try {
    const result = await refreshAllRates({ force: true });
    await publishMetric(result.lastRefreshEpoch);
    return buildResponse(200, result, origin);
  } catch (error) {
    const lastEpoch = await getLastRefreshEpoch();
    await publishMetric(lastEpoch);
    return buildResponse(500, { error: (error as Error).message }, origin);
  }
};
