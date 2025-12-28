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
import { addCrudResource } from './api-helpers';

export class BudgetTrackerAwsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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

    const baseCurrency =
      (this.node.tryGetContext('baseCurrency') as string) || 'EUR';
    const supportedCurrencies =
      (this.node.tryGetContext('supportedCurrencies') as string) ||
      'EUR,BGN,USD,GBP';
    const currencyApiUrl =
      (this.node.tryGetContext('currencyApiUrl') as string) ||
      process.env.CURRENCY_API_URL ||
      'https://api.currencyapi.com/v3/latest';
    const currencyApiSecretArn =
      (this.node.tryGetContext('currencyApiSecretArn') as string) ||
      'arn:aws:secretsmanager:eu-central-1:967206684166:secret:CURRENCYAPI_KEY-W7IY2B';

    const currencyApiSecret = currencyApiSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          'CurrencyApiSecret',
          currencyApiSecretArn,
        )
      : undefined;

    const persistedFreshMs = Number(
      this.node.tryGetContext('currencyPersistedFreshMs') ??
        24 * 60 * 60 * 1000,
    );
    const persistedTtlDays = Number(
      this.node.tryGetContext('currencyPersistedTtlDays') ?? 30,
    );
    const ratesAdminGroup =
      (this.node.tryGetContext('ratesAdminGroup') as string) || 'rates-admins';

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
      CURRENCY_API_URL: currencyApiUrl,
      CURRENCY_API_SECRET_ARN: currencyApiSecret?.secretArn ?? '',
      USER_TABLE_NAME: userPreferencesTable.tableName,
      RATES_TABLE_NAME: exchangeRatesTable.tableName,
      CURRENCY_PERSISTED_FRESH_MS: String(persistedFreshMs),
      CURRENCY_PERSISTED_TTL_DAYS: String(persistedTtlDays),
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
