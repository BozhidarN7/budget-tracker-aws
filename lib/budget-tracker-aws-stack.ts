import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

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

    const sharedLambdaEnv = {
      BASE_CURRENCY: baseCurrency,
      SUPPORTED_CURRENCIES: supportedCurrencies,
      CURRENCY_API_URL: currencyApiUrl,
      CURRENCY_API_SECRET_ARN: currencyApiSecret?.secretArn ?? '',
      USER_TABLE_NAME: userPreferencesTable.tableName,
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
    currencyApiSecret?.grantRead(userLambda);

    const api = new apigateway.RestApi(this, 'BudgetTrackerApi', {
      restApiName: 'Budget Tracker Service',
      deployOptions: { stageName: 'prod' },
    });

    const allowOrigins = [
      'https://localhost:3000',
      'https://budget-tracker-5onkq23od-bozhidarn7s-projects.vercel.app',
      'https://budget-tracker-henna-phi.vercel.app',
    ];

    Object.entries(lambdas).forEach(([name, lambdaFn]) => {
      const resource = api.root.addResource(name.toLowerCase() + 's');

      // /<resource> (GET, POST)
      resource.addMethod('GET', new apigateway.LambdaIntegration(lambdaFn), {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });
      resource.addMethod('POST', new apigateway.LambdaIntegration(lambdaFn), {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });

      // /<resource>/{id} (GET, PUT, DELETE)
      const single = resource.addResource('{id}');
      single.addMethod('GET', new apigateway.LambdaIntegration(lambdaFn), {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });
      single.addMethod('PUT', new apigateway.LambdaIntegration(lambdaFn), {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });
      single.addMethod('DELETE', new apigateway.LambdaIntegration(lambdaFn), {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      });

      resource.addCorsPreflight({
        allowOrigins,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      });

      single.addCorsPreflight({
        allowOrigins,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      });
    });

    const usersResource = api.root.addResource('users');
    usersResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(userLambda),
      {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      },
    );
    usersResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(userLambda),
      {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      },
    );
    usersResource.addMethod(
      'PUT',
      new apigateway.LambdaIntegration(userLambda),
      {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer,
      },
    );

    const singleUser = usersResource.addResource('{id}');
    singleUser.addMethod('GET', new apigateway.LambdaIntegration(userLambda), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer,
    });

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
  }
}
