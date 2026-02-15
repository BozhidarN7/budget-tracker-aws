import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import type * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { addCrudResource } from './api-helpers';

export interface ApiResourcesParams {
  api: apigateway.RestApi;
  lambdas: Record<string, lambda.NodejsFunction>;
  recurringTransactionsLambda: lambda.NodejsFunction;
  manualRatesRefreshLambda: lambda.NodejsFunction;
  userLambda: lambda.NodejsFunction;
  authOptions: apigateway.MethodOptions;
  allowOrigins: string[];
}

export const createApiResources = (
  scope: Construct,
  params: ApiResourcesParams,
): void => {
  const {
    api,
    lambdas,
    recurringTransactionsLambda,
    manualRatesRefreshLambda,
    userLambda,
    authOptions,
    allowOrigins,
  } = params;

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
};
