import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

export type SharedLambdaEnv = Record<string, string> & {
  BASE_CURRENCY: string;
  SUPPORTED_CURRENCIES: string;
  CURRENCY_API_URL: string;
  CURRENCY_API_SECRET_ARN: string;
  USER_TABLE_NAME: string;
  RATES_TABLE_NAME: string;
  CURRENCY_PERSISTED_FRESH_MS: string;
  CURRENCY_PERSISTED_TTL_DAYS: string;
};

export interface CrudLambdaResources {
  lambdas: Record<string, lambda.NodejsFunction>;
  userLambda: lambda.NodejsFunction;
  recurringTransactionsLambda: lambda.NodejsFunction;
  ratesRefreshLambda: lambda.NodejsFunction;
  manualRatesRefreshLambda: lambda.NodejsFunction;
}

export interface LambdaResourceParams {
  sharedLambdaEnv: SharedLambdaEnv;
  tables: Record<string, dynamodb.Table>;
  userPreferencesTable: dynamodb.Table;
  exchangeRatesTable: dynamodb.Table;
  recurringTransactionsTable: dynamodb.Table;
  currencyApiSecret?: secretsmanager.ISecret;
  ratesAdminGroup: string;
}

export const createLambdaResources = (
  scope: Construct,
  params: LambdaResourceParams,
): CrudLambdaResources => {
  const {
    sharedLambdaEnv,
    tables,
    userPreferencesTable,
    exchangeRatesTable,
    recurringTransactionsTable,
    currencyApiSecret,
    ratesAdminGroup,
  } = params;

  const lambdas = Object.entries(tables).reduce(
    (acc, [name, table]) => {
      const handler = new lambda.NodejsFunction(scope, `${name}Handler`, {
        entry: path.join(
          __dirname,
          `../lambdas/${name.toLowerCase()}s/handler.ts`,
        ),
        handler: 'handler',
        timeout: cdk.Duration.seconds(10),
        runtime: Runtime.NODEJS_22_X,
        environment: {
          TABLE_NAME: table.tableName,
          ...sharedLambdaEnv,
        },
      });

      table.grantReadWriteData(handler);
      userPreferencesTable.grantReadData(handler);
      exchangeRatesTable.grantReadWriteData(handler);
      currencyApiSecret?.grantRead(handler);
      acc[name] = handler;
      return acc;
    },
    {} as Record<string, lambda.NodejsFunction>,
  );

  const userLambda = new lambda.NodejsFunction(
    scope,
    'UserPreferencesHandler',
    {
      entry: path.join(__dirname, '../lambdas/users/handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      environment: sharedLambdaEnv,
    },
  );

  userPreferencesTable.grantReadWriteData(userLambda);
  exchangeRatesTable.grantReadWriteData(userLambda);
  currencyApiSecret?.grantRead(userLambda);

  const recurringTransactionsLambda = new lambda.NodejsFunction(
    scope,
    'RecurringTransactionsHandler',
    {
      entry: path.join(
        __dirname,
        '../lambdas/recurring-transactions/handler.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      environment: {
        TABLE_NAME: recurringTransactionsTable.tableName,
        ...sharedLambdaEnv,
      },
    },
  );

  recurringTransactionsTable.grantReadWriteData(recurringTransactionsLambda);
  userPreferencesTable.grantReadData(recurringTransactionsLambda);
  exchangeRatesTable.grantReadWriteData(recurringTransactionsLambda);
  currencyApiSecret?.grantRead(recurringTransactionsLambda);

  const ratesRefreshLambda = new lambda.NodejsFunction(
    scope,
    'RatesRefreshHandler',
    {
      entry: path.join(__dirname, '../lambdas/rates/refresh.ts'),
      handler: 'scheduledHandler',
      runtime: Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      environment: sharedLambdaEnv,
    },
  );

  exchangeRatesTable.grantReadWriteData(ratesRefreshLambda);
  currencyApiSecret?.grantRead(ratesRefreshLambda);
  ratesRefreshLambda.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }),
  );

  const manualRatesRefreshLambda = new lambda.NodejsFunction(
    scope,
    'ManualRatesRefreshHandler',
    {
      entry: path.join(__dirname, '../lambdas/rates/refresh.ts'),
      handler: 'manualHandler',
      runtime: Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      environment: {
        ...sharedLambdaEnv,
        RATES_REFRESH_ALLOWED_GROUP: ratesAdminGroup,
      },
    },
  );

  exchangeRatesTable.grantReadWriteData(manualRatesRefreshLambda);
  currencyApiSecret?.grantRead(manualRatesRefreshLambda);
  manualRatesRefreshLambda.addToRolePolicy(
    new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
    }),
  );

  return {
    lambdas,
    userLambda,
    recurringTransactionsLambda,
    ratesRefreshLambda,
    manualRatesRefreshLambda,
  };
};
