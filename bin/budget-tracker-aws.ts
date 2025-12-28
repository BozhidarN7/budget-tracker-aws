#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { BudgetTrackerAwsStack } from '../lib/budget-tracker-aws-stack';
import { environments } from '../config/environments';

const app = new cdk.App();
const envName: 'dev' | 'prod' = app.node.tryGetContext('env') ?? 'dev';

const config = environments[envName];

if (!config) {
  throw new Error(`Unknown environment: ${envName}`);
}

new BudgetTrackerAwsStack(app, 'BudgetTrackerAwsStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  ...config,
});
