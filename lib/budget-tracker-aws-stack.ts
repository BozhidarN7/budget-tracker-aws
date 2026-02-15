import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { BudgetTrackerStackProps } from '../types/stack-props';
import { createApiResources } from './stack-api';
import { createAuthResources } from './stack-auth';
import { createDataTables } from './stack-data';
import { createLambdaResources } from './stack-lambdas';
import { createMonitoringResources } from './stack-monitoring';

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

    const { userPool, userPoolClient, authOptions } = createAuthResources(this);

    const currencyApiSecret = currencyApi.secretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          'CurrencyApiSecret',
          currencyApi.secretArn,
        )
      : undefined;

    const {
      userPreferencesTable,
      exchangeRatesTable,
      recurringTransactionsTable,
      tables,
    } = createDataTables(this);

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

    const {
      lambdas,
      userLambda,
      recurringTransactionsLambda,
      ratesRefreshLambda,
      manualRatesRefreshLambda,
    } = createLambdaResources(this, {
      sharedLambdaEnv,
      tables,
      userPreferencesTable,
      exchangeRatesTable,
      recurringTransactionsTable,
      currencyApiSecret,
      ratesAdminGroup,
    });

    const api = new apigateway.RestApi(this, 'BudgetTrackerApi', {
      restApiName: 'Budget Tracker Service',
      deployOptions: { stageName: 'prod' },
    });

    const allowOrigins = [
      'https://localhost:3000',
      'https://budget-tracker-5onkq23od-bozhidarn7s-projects.vercel.app',
      'https://budget-tracker-henna-phi.vercel.app',
    ];

    createApiResources(this, {
      api,
      lambdas,
      recurringTransactionsLambda,
      manualRatesRefreshLambda,
      userLambda,
      authOptions,
      allowOrigins,
    });

    const { ratesAlertsTopic } = createMonitoringResources(
      this,
      ratesRefreshLambda,
    );

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
