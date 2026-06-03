import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DataTables {
  userPreferencesTable: dynamodb.Table;
  exchangeRatesTable: dynamodb.Table;
  recurringTransactionsTable: dynamodb.Table;
  tables: Record<string, dynamodb.Table>;
}

const getPhysicalName = (
  environmentName: 'dev' | 'prod',
  baseName: string,
): string => (environmentName === 'prod' ? baseName : `${baseName}-dev`);

export const createDataTables = (
  scope: Construct,
  environmentName: 'dev' | 'prod',
): DataTables => {
  const userPreferencesTable = new dynamodb.Table(
    scope,
    'UserPreferencesTable',
    {
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      tableName: getPhysicalName(environmentName, 'users'),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    },
  );

  const exchangeRatesTable = new dynamodb.Table(scope, 'ExchangeRatesTable', {
    partitionKey: {
      name: 'fromCurrency',
      type: dynamodb.AttributeType.STRING,
    },
    sortKey: { name: 'toCurrency', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    tableName: getPhysicalName(environmentName, 'exchangeRates'),
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    timeToLiveAttribute: 'ttlEpoch',
  });

  const tables = ['Transaction', 'Category', 'Goal'].reduce(
    (acc, name) => {
      acc[name] = new dynamodb.Table(scope, `${name}Table`, {
        partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        tableName: getPhysicalName(environmentName, name.toLowerCase() + 's'),
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      return acc;
    },
    {} as Record<string, dynamodb.Table>,
  );

  const recurringTransactionsTable = new dynamodb.Table(
    scope,
    'RecurringTransactionsTable',
    {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      tableName: getPhysicalName(environmentName, 'recurring-transactions'),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    },
  );

  recurringTransactionsTable.addGlobalSecondaryIndex({
    indexName: 'status-nextOccurrence-index',
    partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'nextOccurrence', type: dynamodb.AttributeType.STRING },
    projectionType: dynamodb.ProjectionType.ALL,
  });

  return {
    userPreferencesTable,
    exchangeRatesTable,
    recurringTransactionsTable,
    tables,
  };
};
