import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { BudgetTrackerStackProps } from '../types/stack-props';
import { addCrudResource } from './api-helpers';

export class BudgetTrackerAwsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BudgetTrackerStackProps) {
    super(scope, id, props);

    const {
      baseCurrency,
      supportedCurrencies,
      currencyApi,
      currencyRates,
      ratesAdminGroup,
    } = props;

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      autoVerify: { email: false },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: false,
      authFlows: {
        userPassword: true,
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'BudgetApiAuthorizer',
      {
        cognitoUserPools: [userPool],
      },
    );

    const authOptions: apigateway.MethodOptions = {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    };

    const currencyApiSecret = currencyApi.secretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          'CurrencyApiSecret',
          currencyApi.secretArn,
        )
      : undefined;

    const userPreferencesTable = new dynamodb.Table(
      this,
      'UserPreferencesTable',
      {
        partitionKey: {
          name: 'userId',
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        tableName: 'users',
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    const exchangeRatesTable = new dynamodb.Table(this, 'ExchangeRatesTable', {
      partitionKey: {
        name: 'fromCurrency',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: 'toCurrency', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      tableName: 'exchangeRates',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttlEpoch',
    });

    const sharedLambdaEnv = {
      BASE_CURRENCY: baseCurrency,
      SUPPORTED_CURRENCIES: supportedCurrencies,
      CURRENCY_API_URL: currencyApi.url,
      CURRENCY_API_SECRET_ARN: currencyApiSecret?.secretArn ?? '',
      USER_TABLE_NAME: userPreferencesTable.tableName,
      RATES_TABLE_NAME: exchangeRatesTable.tableName,
      CURRENCY_PERSISTED_FRESH_MS: String(currencyRates.persistedFreshMs),
      CURRENCY_PERSISTED_TTL_DAYS: String(currencyRates.persistedTtlDays),
    };

    const tables = ['Transaction', 'Category', 'Goal'].reduce(
      (acc, name) => {
        acc[name] = new dynamodb.Table(this, `${name}Table`, {
          partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
          billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
          tableName: name.toLowerCase() + 's',
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        return acc;
      },
      {} as Record<string, dynamodb.Table>,
    );

    const lambdas = Object.entries(tables).reduce(
      (acc, [name, table]) => {
        const handler = new lambda.NodejsFunction(this, `${name}Handler`, {
          entry: path.join(
            __dirname,
            `../lambdas/${name.toLowerCase()}s/handler.ts`,
          ),
          handler: 'handler',
          timeout: cdk.Duration.seconds(10),
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
      this,
      'UserPreferencesHandler',
      {
        entry: path.join(__dirname, '../lambdas/users/handler.ts'),
        handler: 'handler',
        environment: sharedLambdaEnv,
      },
    );

    userPreferencesTable.grantReadWriteData(userLambda);
    exchangeRatesTable.grantReadWriteData(userLambda);
    currencyApiSecret?.grantRead(userLambda);

    const recurringTransactionsTable = new dynamodb.Table(
      this,
      'RecurringTransactionsTable',
      {
        partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        tableName: 'recurring-transactions',
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    const recurringTransactionsLambda = new lambda.NodejsFunction(
      this,
      'RecurringTransactionsHandler',
      {
        entry: path.join(
          __dirname,
          '../lambdas/recurring-transactions/handler.ts',
        ),
        handler: 'handler',
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
      this,
      'RatesRefreshHandler',
      {
        entry: path.join(__dirname, '../lambdas/rates/refresh.ts'),
        handler: 'scheduledHandler',
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
      this,
      'ManualRatesRefreshHandler',
      {
        entry: path.join(__dirname, '../lambdas/rates/refresh.ts'),
        handler: 'manualHandler',
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

    const api = new apigateway.RestApi(this, 'BudgetTrackerApi', {
      restApiName: 'Budget Tracker Service',
      deployOptions: { stageName: 'prod' },
    });

    const allowOrigins = [
      'https://localhost:3000',
      'https://budget-tracker-5onkq23od-bozhidarn7s-projects.vercel.app',
      'https://budget-tracker-henna-phi.vercel.app',
    ];

    Object.entries(lambdas).forEach(([name, lambdaFn]) =>
      addCrudResource(
        api,
        name.toLowerCase() + 's',
        lambdaFn,
        authOptions,
        allowOrigins,
      ),
    );

    addCrudResource(
      api,
      'recurring-transactions',
      recurringTransactionsLambda,
      authOptions,
      allowOrigins,
    );

    const ratesResource = api.root.addResource('rates');
    const refreshResource = ratesResource.addResource('refresh');
    refreshResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(manualRatesRefreshLambda),
      authOptions,
    );

    ratesResource.addCorsPreflight({
      allowOrigins,
      allowMethods: ['POST', 'OPTIONS'],
    });
    refreshResource.addCorsPreflight({
      allowOrigins,
      allowMethods: ['POST', 'OPTIONS'],
    });

    new events.Rule(this, 'RatesHourlyRefreshRule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new targets.LambdaFunction(ratesRefreshLambda)],
    });

    const ratesAlertsTopic = new sns.Topic(this, 'RatesAlertsTopic');

    const hoursSinceRefreshMetric = new cloudwatch.Metric({
      namespace: 'BudgetTracker/Rates',
      metricName: 'HoursSinceRefresh',
      period: cdk.Duration.hours(1),
      statistic: 'max',
    });

    const ratesStaleAlarm = new cloudwatch.Alarm(this, 'RatesStaleAlarm', {
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

    const usersResource = api.root.addResource('users');
    const userIntegration = new apigateway.LambdaIntegration(userLambda);
    usersResource.addMethod('GET', userIntegration, authOptions);
    usersResource.addMethod('POST', userIntegration, authOptions);
    usersResource.addMethod('PUT', userIntegration, authOptions);

    const singleUser = usersResource.addResource('{id}');
    singleUser.addMethod('GET', userIntegration, authOptions);

    usersResource.addCorsPreflight({
      allowOrigins,
      allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    });
    singleUser.addCorsPreflight({
      allowOrigins,
      allowMethods: ['GET', 'OPTIONS'],
    });

    new cdk.CfnOutput(this, 'UserPoolIdOutput', {
      value: userPool.userPoolId,
      exportName: 'UserPoolId',
    });
    new cdk.CfnOutput(this, 'UserPoolClientIdOutput', {
      value: userPoolClient.userPoolClientId,
      exportName: 'UserPoolClientId',
    });
    new cdk.CfnOutput(this, 'ExchangeRatesTableNameOutput', {
      value: exchangeRatesTable.tableName,
      exportName: 'ExchangeRatesTableName',
    });
    new cdk.CfnOutput(this, 'RatesAlertsTopicArn', {
      value: ratesAlertsTopic.topicArn,
      exportName: 'RatesAlertsTopicArn',
    });
  }
}
