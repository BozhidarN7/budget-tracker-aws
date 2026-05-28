# Budget Tracker AWS - Project Documentation

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [API Endpoints](#api-endpoints)
- [Data Model](#data-model)
- [Lambda Functions](#lambda-functions)
- [Currency System](#currency-system)
- [Deployment](#deployment)
- [Testing](#testing)

## Project Overview

Budget Tracker AWS is a serverless budget tracking application that provides RESTful APIs for managing personal finances. It uses AWS CDK for infrastructure-as-code deployment.

### Key Features

- **Multi-currency support**: EUR, BGN, USD, GBP with automatic conversion
- **Recurring transactions**: Monthly, weekly, or biweekly scheduled transactions
- **User preferences**: Per-user currency preference stored in DynamoDB
- **Rate caching**: Exchange rates cached in memory and persisted to DynamoDB
- **Auth integration**: Cognito-based authentication on all endpoints

## Architecture

### Infrastructure Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    BudgetTrackerAwsStack                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌──────────────────┐             │
│  │  Cognito User   │    │  API Gateway     │             │
│  │  Pool + Client  │    │  + Authorizer    │             │
│  └────────┬────────┘    └─────────┬──────────┘             │
│           │                       │                        │
│           └───────────────────────┼────────────────────────┘
│                                 │                          │
│  ┌─────────────────┐            │                          │
│  │   DynamoDB      │            │                          │
│  │   Tables:       │            │                          │
│  │   - users       │            │                          │
│  │   - exchangeRates│            │                          │
│  │   - transactions│            │                          │
│  │   - categories  │            │                          │
│  │   - goals       │            │                          │
│  │   - recurring-  │            │                          │
│  │     transactions│            │                          │
│  └─────────────────┘                                         │
│                                                              │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ EventBridge     │───▶│ RatesRefresh     │               │
│  │ (hourly)        │    │ Lambda           │               │
│  └─────────────────┘    └────────┬─────────┘               │
│                                   │                          │
│                                   ▼                          │
│                        ┌──────────────────┐               │
│                        │ CloudWatch       │               │
│                        │ Alarms + SNS     │               │
│                        └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

| Path                        | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `bin/budget-tracker-aws.ts` | CDK app entry point, loads environment config |
| `lib/`                      | CDK stack definitions (modular by concern)    |
| `lambdas/`                  | Lambda function handlers (one per resource)   |
| `utils/`                    | Shared business logic functions               |
| `types/`                    | TypeScript type definitions                   |
| `config/`                   | Environment-specific configuration            |
| `test/`                     | Jest test files                               |

## API Endpoints

### Authentication

All endpoints require Cognito authentication via JWT token in the `Authorization` header.

### CORS

Allowed origins are configured in:

- `lib/budget-tracker-aws-stack.ts` (line 73-77)
- `utils/build-response.ts` (line 2-5)

### Endpoints

| Method | Path                         | Handler                                     | Description                      |
| ------ | ---------------------------- | ------------------------------------------- | -------------------------------- |
| GET    | /transactions                | `lambdas/transactions/handler.ts`           | List all user transactions       |
| GET    | /transactions/{id}           | `lambdas/transactions/handler.ts`           | Get single transaction           |
| POST   | /transactions                | `lambdas/transactions/handler.ts`           | Create transaction               |
| PUT    | /transactions/{id}           | `lambdas/transactions/handler.ts`           | Update transaction               |
| DELETE | /transactions/{id}           | `lambdas/transactions/handler.ts`           | Delete transaction               |
| GET    | /categories                  | `lambdas/categorys/handler.ts`              | List all user categories         |
| GET    | /categories/{id}             | `lambdas/categorys/handler.ts`              | Get single category              |
| POST   | /categories                  | `lambdas/categorys/handler.ts`              | Create category                  |
| PUT    | /categories/{id}             | `lambdas/categorys/handler.ts`              | Update category                  |
| DELETE | /categories/{id}             | `lambdas/categorys/handler.ts`              | Delete category                  |
| GET    | /goals                       | `lambdas/goals/handler.ts`                  | List all user goals              |
| GET    | /goals/{id}                  | `lambdas/goals/handler.ts`                  | Get single goal                  |
| POST   | /goals                       | `lambdas/goals/handler.ts`                  | Create goal                      |
| PUT    | /goals/{id}                  | `lambdas/goals/handler.ts`                  | Update goal                      |
| DELETE | /goals/{id}                  | `lambdas/goals/handler.ts`                  | Delete goal                      |
| GET    | /recurring-transactions      | `lambdas/recurring-transactions/handler.ts` | List recurring                   |
| GET    | /recurring-transactions/{id} | `lambdas/recurring-transactions/handler.ts` | Get recurring                    |
| POST   | /recurring-transactions      | `lambdas/recurring-transactions/handler.ts` | Create recurring                 |
| PUT    | /recurring-transactions/{id} | `lambdas/recurring-transactions/handler.ts` | Update recurring                 |
| DELETE | /recurring-transactions/{id} | `lambdas/recurring-transactions/handler.ts` | Delete recurring                 |
| GET    | /users/{id}                  | `lambdas/users/handler.ts`                  | Get user preferences (own only)  |
| GET    | /users                       | `lambdas/users/handler.ts`                  | Get own user preferences         |
| POST   | /users                       | `lambdas/users/handler.ts`                  | Create preference                |
| PUT    | /users                       | `lambdas/users/handler.ts`                  | Update own preference            |
| POST   | /rates/refresh               | `lambdas/rates/refresh.ts`                  | Manual rate refresh (admin only) |

## Data Model

### DynamoDB Tables

#### users

- **PK**: `userId` (string)
- Stores user preferences (preferred currency)

#### exchangeRates

- **PK**: `fromCurrency`
- **SK**: `toCurrency`
- Stores cached exchange rates with TTL

#### transactions

- **PK**: `id` (UUID)
- Stores transaction records

#### categories

- **PK**: `id` (UUID)
- Stores spending categories with monthly limits

#### goals

- **PK**: `id` (UUID)
- Stores savings goals

#### recurring-transactions

- **PK**: `id` (UUID)
- Stores recurring transaction definitions

### Type Definitions

All domain types are defined in `types/budget.ts`:

```typescript
// Currency support
type CurrencyCode = 'EUR' | 'BGN' | 'USD' | 'GBP'

// Recurring frequency options
type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly'

// Core entities
interface Transaction { id, description, amount, currency, baseAmount, ... }
interface Category { id, name, color, type, monthlyData, ... }
interface Goal { id, name, target, current, targetDate, ... }
interface UserPreference { userId, preferredCurrency, updatedAt }
interface RecurringTransaction { id, description, rule, status, ... }
```

## Lambda Functions

### Handler Pattern

Each Lambda follows a consistent structure for auth, error handling, and response building. See [AGENTS.md](../AGENTS.md#lambda-handler-pattern) for details.

### Currency Conversion Flow

1. Incoming requests with currency convert to EUR (base) on write
2. Stored amounts always in EUR in DynamoDB
3. On read, amounts converted to user's preferred currency
4. Rate context created per-request: `createRateContext()`
5. Fallback to stale rates if API fails

### Rate Refresh Lambda

Two handlers in `lambdas/rates/refresh.ts`:

- `scheduledHandler`: EventBridge-triggered hourly refresh
- `manualHandler`: API-triggered refresh (requires `rates-admins` group)

## Currency System

### Configuration

Environment variables (set in `lib/stack-lambdas.ts`):

- `BASE_CURRENCY`: Base currency code (EUR)
- `SUPPORTED_CURRENCIES`: Comma-separated codes
- `CURRENCY_API_URL`: External API endpoint
- `CURRENCY_API_SECRET_ARN`: Secrets Manager ARN for API key
- `RATES_TABLE_NAME`: DynamoDB table for rate persistence
- `CURRENCY_PERSISTED_FRESH_MS`: Freshness threshold (24h default)
- `CURRENCY_PERSISTED_TTL_DAYS`: TTL for stored rates (30 days default)

### Cache Layers

1. **In-memory**: Per-container cache with 5-minute TTL
2. **DynamoDB**: Persistent cache with configurable freshness
3. **Fallback**: Stale rates returned when API unavailable

### Rate Fetching

Rates are fetched from currencyapi.com. The system:

- Fetches all currency pairs in batch requests
- Stores with TTL for historical fallback
- Tracks last refresh time in metadata record
- Emits CloudWatch metrics for monitoring

## Deployment

### Prerequisites

- Node.js 24.x (see `.nvmrc`)
- AWS CLI configured
- AWS CDK bootstrapped in target account

### Commands

```bash
# Deploy to dev (default)
npx cdk deploy --context env=dev

# Deploy to prod
npx cdk deploy --context env=prod

# Preview changes
npx cdk diff --context env=dev

# Synthesize template
npx cdk synth --context env=dev
```

### Stack Outputs

After deployment, these are available as CloudFormation outputs:

- `UserPoolId`
- `UserPoolClientId`
- `ExchangeRatesTableName`
- `RatesAlertsTopicArn`

## Testing

### Running Tests

```bash
npm run test
```

### Test Structure

- Unit tests in `test/` directory
- Uses Jest with ts-jest transformer
- Test environment: Node.js

### Code Quality

Pre-commit hooks run automatically:

```bash
npm run format  # Prettier + ESLint fix
npm run ts:check  # TypeScript type check
```
