import { ScheduledHandler } from 'aws-lambda';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import { materializeRecurring } from '../../utils/recurring';

const cloudWatchClient = new CloudWatchClient({});
const metricNamespace = 'BudgetTracker/RecurringMaterializer';

const publishMetrics = async (summary: {
  processed: number;
  created: number;
  skipped: number;
  failures: number;
}) => {
  await cloudWatchClient.send(
    new PutMetricDataCommand({
      Namespace: metricNamespace,
      MetricData: [
        {
          MetricName: 'Processed',
          Value: summary.processed,
          Unit: 'Count',
        },
        {
          MetricName: 'Created',
          Value: summary.created,
          Unit: 'Count',
        },
        {
          MetricName: 'Skipped',
          Value: summary.skipped,
          Unit: 'Count',
        },
        {
          MetricName: 'Failures',
          Value: summary.failures,
          Unit: 'Count',
        },
      ],
    }),
  );
};

export const handler: ScheduledHandler = async () => {
  try {
    const summary = await materializeRecurring();
    await publishMetrics(summary);
    console.log('Recurring materialization completed', summary);
  } catch (error) {
    console.error('Recurring materialization failed', error);
    await publishMetrics({ processed: 0, created: 0, skipped: 0, failures: 1 });
    throw error;
  }
};
