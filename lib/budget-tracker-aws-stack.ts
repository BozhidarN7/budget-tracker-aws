import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

export class BudgetTrackerAwsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

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
      resource.addMethod('GET', new apigateway.LambdaIntegration(lambdaFn));
      resource.addMethod('POST', new apigateway.LambdaIntegration(lambdaFn));

      // /<resource>/{id} (GET, PUT, DELETE)
      const single = resource.addResource('{id}');
      single.addMethod('GET', new apigateway.LambdaIntegration(lambdaFn));
      single.addMethod('PUT', new apigateway.LambdaIntegration(lambdaFn));
      single.addMethod('DELETE', new apigateway.LambdaIntegration(lambdaFn));

      resource.addCorsPreflight({
        allowOrigins: ['https://localhost:3000'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      });
      single.addCorsPreflight({
        allowOrigins: ['https://localhost:3000'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      });
    });
  }
}
