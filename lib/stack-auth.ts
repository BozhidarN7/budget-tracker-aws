import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface AuthResources {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  authorizer: apigateway.CognitoUserPoolsAuthorizer;
  authOptions: apigateway.MethodOptions;
}

export const createAuthResources = (scope: Construct): AuthResources => {
  const userPool = new cognito.UserPool(scope, 'UserPool', {
    selfSignUpEnabled: false,
    signInAliases: { username: true },
    autoVerify: { email: false },
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  });

  const userPoolClient = new cognito.UserPoolClient(scope, 'UserPoolClient', {
    userPool,
    generateSecret: false,
    authFlows: {
      userPassword: true,
    },
  });

  const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
    scope,
    'BudgetApiAuthorizer',
    {
      cognitoUserPools: [userPool],
    },
  );

  const authOptions: apigateway.MethodOptions = {
    authorizationType: apigateway.AuthorizationType.COGNITO,
    authorizer,
  };

  return {
    userPool,
    userPoolClient,
    authorizer,
    authOptions,
  };
};
