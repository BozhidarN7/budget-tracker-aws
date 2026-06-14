# Budget Tracker AWS - Agent Development Guide

This document describes the software engineering practices, coding standards, and project conventions for the Budget Tracker AWS CDK project.

## Collaboration Expectations

- Tell the user the important thing they need to know, even when it is inconvenient, unwelcome, or cuts against the current direction.
- Push back on incorrect assumptions, weak reasoning, or risky requests. Do not agree just to keep momentum.
- Ask a clarifying question when a decision is materially ambiguous and the wrong choice would change behavior, API shape, architecture, risk, scope, or cost. Do not make random important choices.
- Distinguish facts, assumptions, and recommendations clearly. When evidence is incomplete, say so directly.
- When leading a user-facing response with a likely mistake, omission, or risk, start that response with `❗️`.

## Context Markers

- Use lightweight context markers at the start of the first user-facing response after reading instruction files for the task.
- Marker order should go from broadest scope to narrowest scope.
- Only include markers for instruction sources that materially shaped the answer. Do not stack markers for every file read during exploration.
- Use the current marker registry:
- `🍀` root repo instructions in this file
- `🌐` `apps/web/AGENTS.md`
- `📘` repo docs or other non-AGENTS instruction documents that materially affected the answer
- If a needed context marker is missing from the registry, say so plainly instead of inventing a new emoji on the fly.
- Markers are a visibility aid, not proof of understanding. Keep the marker prefix short and let the actual answer demonstrate comprehension.

## Response State Markers

- After any context markers, an answer may include at most one response-state marker when it adds real signal.
- Use response-state markers sparingly. Omit them when the answer is straightforward and the state is obvious from the content.
- Use the current response-state registry:
- `❓` a material clarification is required before making an important choice
- `🧪` the answer or change was validated with a targeted test, typecheck, lint run, or other focused executable check
- `📘` the answer is primarily derived from documentation or instruction files rather than code execution
- Do not stack multiple response-state markers. Choose the single marker that best describes the current answer.
- Response-state markers supplement the answer; they do not replace stating concrete evidence, uncertainty, or next steps.

## Project Overview

A serverless budget tracking application built with AWS CDK (TypeScript) that provides:

- CRUD operations for transactions, categories, and goals
- Currency conversion with caching and fallback mechanisms
- Recurring transactions support
- Cognito-based authentication
- Automated exchange rate refresh via EventBridge

## Architecture

```
bin/budget-tracker-aws.ts    # CDK app entry point
lib/
├── budget-tracker-aws-stack.ts   # Main stack orchestrator
├── stack-api.ts           # API Gateway resources and CORS
├── stack-auth.ts          # Cognito user pool configuration
├── stack-data.ts          # DynamoDB table definitions
├── stack-lambdas.ts       # Lambda function definitions
└── stack-monitoring.ts    # EventBridge rules, CloudWatch alarms, SNS
lambdas/
├── categorys/handler.ts
├── goals/handler.ts
├── recurring-transactions/handler.ts
├── transactions/handler.ts
├── users/handler.ts
└── rates/refresh.ts
utils/
├── build-response.ts      # Standardized API response builder
├── currency.ts            # Currency conversion with caching
├── currency-config.ts     # Configuration and secret retrieval
├── rates-store.ts         # DynamoDB persistence for exchange rates
├── recurrence.ts          # Recurring transaction calculations
└── user-preferences.ts    # User preference CRUD operations
types/
├── budget.ts              # Domain types (Transaction, Category, Goal, etc.)
└── stack-props.ts         # CDK stack props interface
config/
└── environments.ts        # Environment-specific configuration
test/                     # Jest tests
```

## Coding Conventions

### TypeScript & Module System

- **Target**: ES2022, `module: "NodeNext"`, `moduleResolution: "NodeNext"`
- **Strict mode enabled**: All strict type-checking options enabled
- **No default exports**: Use named exports throughout
- **File extensions in imports**: Always include `.ts` extension in import paths

### Linting (ESLint v9)

- **Max 300 lines per file** (blank lines and comments skipped)
- **Import ordering**: Enforced via `import/order` rule
- **Sort imports**: Alphabetical, ignore declaration sort
- Extends `js/recommended` + `tseslint/recommended`

### Formatting (Prettier)

- Single quotes
- Semicolons enabled
- Print width: 80 characters

### Pre-commit Hooks (Husky)

- Auto-runs `npm run format` (Prettier + ESLint fix) on commit

## Lambda Handler Pattern

All Lambda handlers follow a consistent structure:

```typescript
// 1. Imports at top (AWS SDK v3 client/marshal pattern)
import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

// 2. Module-level constants
const client = new DynamoDBClient({});
const TABLE_NAME = process.env.TABLE_NAME!;

// 3. Helper functions (pure, testable)
const normalizeX = async (...) => { ... }

// 4. Handler exports
export const handler: APIGatewayProxyHandler = async (event) => {
  // 4a. Extract request context
  const { httpMethod, pathParameters, body, requestContext } = event;
  const origin = event.headers.origin || event.headers.Origin;
  const userId = requestContext.authorizer?.claims?.sub;

  // 4b. Auth check
  if (!userId) {
    return buildResponse(401, { message: 'Unauthorized' }, origin);
  }

  // 4c. Try/catch with method routing
  try {
    if (httpMethod === 'GET' && id) { ... }
    if (httpMethod === 'POST' && body) { ... }
    // etc.
    return buildResponse(400, { message: 'Unsupported method' }, origin);
  } catch (err) {
    return buildResponse(500, { error: (err as Error).message }, origin);
  }
};
```

## Domain Types

Types are defined in `types/budget.ts`:

- `CurrencyCode`: 'EUR' | 'BGN' | 'USD' | 'GBP' (base currency is EUR)
- `RecurringFrequency`: 'weekly' | 'biweekly' | 'monthly'
- Base currency amounts stored in EUR, converted on read for user's preferred currency

## Environment Configuration

Configuration in `config/environments.ts`:

- `dev` and `prod` environments supported
- Pass via context: `npx cdk deploy --context env=dev`
- Defaults to `dev` if not specified

Supported config properties:

- `baseCurrency`: BASE_CURRENCY_CODE ('EUR')
- `supportedCurrencies`: Comma-separated currency codes
- `currencyApi`: `{ url, secretArn }`
- `currencyRates`: `{ persistedFreshMs, persistedTtlDays }`
- `ratesAdminGroup`: Cognito group for manual rate refresh

## Commands

| Command            | Description                        |
| ------------------ | ---------------------------------- |
| `npm run build`    | Compile TypeScript                 |
| `npm run watch`    | Watch mode compilation             |
| `npm run test`     | Run Jest tests                     |
| `npm run format`   | Format with Prettier + ESLint fix  |
| `npm run ts:check` | TypeScript type check              |
| `npx cdk synth`    | Synthesize CloudFormation template |
| `npx cdk diff`     | Compare deployed vs local          |
| `npx cdk deploy`   | Deploy stack (default dev)         |

## Development Guidelines

1. **Type-first development**: Define types before implementation
2. **Functional helpers**: Keep Lambda handlers thin; extract business logic to utils
3. **CORS origins**: Update in both `lib/budget-tracker-aws-stack.ts` and `utils/build-response.ts`
4. **Currency handling**: Always convert to base currency on write, convert to preferred currency on read
5. **No comments**: Code should be self-documenting; avoid unnecessary comments

## Documentation

See [docs/project.md](./docs/project.md) for detailed project documentation.
