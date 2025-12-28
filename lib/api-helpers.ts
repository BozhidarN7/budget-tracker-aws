import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';

export const addCrudResource = (
  api: apigateway.RestApi,
  name: string,
  lambdaFn: lambda.NodejsFunction,
  authOptions: apigateway.MethodOptions,
  allowOrigins: string[],
) => {
  const resource = api.root.addResource(name);
  const integration = new apigateway.LambdaIntegration(lambdaFn);
  resource.addMethod('GET', integration, authOptions);
  resource.addMethod('POST', integration, authOptions);
  const single = resource.addResource('{id}');
  single.addMethod('GET', integration, authOptions);
  single.addMethod('PUT', integration, authOptions);
  single.addMethod('DELETE', integration, authOptions);
  const corsConfig: apigateway.CorsOptions = {
    allowOrigins,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  };
  resource.addCorsPreflight(corsConfig);
  single.addCorsPreflight(corsConfig);
  return resource;
};
