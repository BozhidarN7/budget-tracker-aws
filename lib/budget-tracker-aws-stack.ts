import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export class BudgetTrackerAwsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { username: true },
      autoVerify: { email: false },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new cognito.UserPoolClient(this, 'UserPoolClient', {
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
          environment: {
            TABLE_NAME: table.tableName,
          },
        });

        table.grantReadWriteData(handler);
        acc[name] = handler;
        return acc;
      },
      {} as Record<string, lambda.NodejsFunction>,
    );

    const api = new apigateway.RestApi(this, 'BudgetTrackerApi', {
      restApiName: 'Budget Tracker Service',
      deployOptions: { stageName: 'prod' },
    });

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

      const allowOrigins = [
        'https://localhost:3000',
        'https://budget-tracker-5onkq23od-bozhidarn7s-projects.vercel.app',
        'https://budget-tracker-henna-phi.vercel.app',
      ];

      resource.addCorsPreflight({
        allowOrigins,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      });

      single.addCorsPreflight({
        allowOrigins,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      });
    });
  }
}
