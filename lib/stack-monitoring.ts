import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import type * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

export interface MonitoringResources {
  ratesAlertsTopic: sns.Topic;
}

export const createMonitoringResources = (
  scope: Construct,
  ratesRefreshLambda: lambda.NodejsFunction,
): MonitoringResources => {
  new events.Rule(scope, 'RatesHourlyRefreshRule', {
    schedule: events.Schedule.rate(cdk.Duration.hours(1)),
    targets: [new targets.LambdaFunction(ratesRefreshLambda)],
  });

  const ratesAlertsTopic = new sns.Topic(scope, 'RatesAlertsTopic');

  const hoursSinceRefreshMetric = new cloudwatch.Metric({
    namespace: 'BudgetTracker/Rates',
    metricName: 'HoursSinceRefresh',
    period: cdk.Duration.hours(1),
    statistic: 'max',
  });

  const ratesStaleAlarm = new cloudwatch.Alarm(scope, 'RatesStaleAlarm', {
    metric: hoursSinceRefreshMetric,
    threshold: 36,
    evaluationPeriods: 1,
    comparisonOperator:
      cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  });

  ratesStaleAlarm.addAlarmAction(
    new cloudwatchActions.SnsAction(ratesAlertsTopic),
  );

  return { ratesAlertsTopic };
};
