# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests
- `npx cdk deploy` deploy this stack to your default AWS account/region
- `npx cdk diff` compare deployed stack with current state
- `npx cdk synth` emits the synthesized CloudFormation template

## Currency rate caching & refresh pipeline

This stack now provisions a dedicated `exchangeRates` DynamoDB table, two Lambda functions, and an EventBridge rule to keep third-party currency API usage well below the 300-request free-tier limit. Key details:

- **Environment variables**
  - `RATES_TABLE_NAME` (injected automatically) – DynamoDB table backing the shared cache.
  - `CURRENCY_PERSISTED_FRESH_MS` (default 86_400_000 ms) – controls how long a persisted rate is considered fresh before the pipeline refreshes it.
  - `CURRENCY_PERSISTED_TTL_DAYS` (default 30 days) – DynamoDB TTL window so historical rates remain available as fallbacks.
  - `RATES_REFRESH_ALLOWED_GROUP` (default `rates-admins`) – Cognito group required to call the manual refresh API.
- **Automatic refresh** – `RatesRefreshHandler` runs every hour via EventBridge but only calls the external API when the last refresh was ≥ 24 hours ago. Successful runs emit a `BudgetTracker/Rates HoursSinceRefresh` metric that feeds a CloudWatch alarm if no fresh data is written within 36 hours.
- **Manual refresh** – `POST /rates/refresh` (behind Cognito) invokes the same refresh Lambda with `force=true`, allowing admins to immediately rotate rates after troubleshooting or deployments.
- **Runtime fallbacks** – `utils/currency.ts` reads from the in-memory cache first, then DynamoDB. If the upstream API throttles or fails, the last stored snapshot is returned (marked as `stale: true`) so user requests continue to work even when the quota is exceeded.
