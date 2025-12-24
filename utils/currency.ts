import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { CurrencyCode, ExchangeRateSnapshot } from '../types/budget';

const secretsClient = new SecretsManagerClient({});
let cachedSecret: { value: string; expiresAt: number } | null = null;
const SECRET_CACHE_TTL_MS = Number(
  process.env.CURRENCY_SECRET_CACHE_TTL_MS ?? 5 * 60 * 1000,
);

const BASE_CURRENCY_ENV = (process.env.BASE_CURRENCY as CurrencyCode) || 'EUR';
const SUPPORTED_CURRENCIES_ENV =
  process.env.SUPPORTED_CURRENCIES || BASE_CURRENCY_ENV;
const CURRENCY_API_URL =
  process.env.CURRENCY_API_URL || 'https://api.currencyapi.com/v3/latest';
const CURRENCY_API_SECRET_ARN = process.env.CURRENCY_API_SECRET_ARN;
const RATE_PROVIDER = process.env.CURRENCY_RATE_PROVIDER || 'currencyapi.com';
const CACHE_TTL_MS = Number(process.env.CURRENCY_CACHE_TTL_MS ?? 5 * 60 * 1000);

type RateCacheEntry = {
  snapshot: ExchangeRateSnapshot;
  expiresAt: number;
};

const rateCache = new Map<string, RateCacheEntry>();

const cacheKey = (from: CurrencyCode, to: CurrencyCode) => `${from}:${to}`;

const supportedCurrencies = SUPPORTED_CURRENCIES_ENV.split(',')
  .map((currency) => currency.trim())
  .filter(Boolean) as CurrencyCode[];

const now = () => Date.now();

export const isSupportedCurrency = (
  currency?: string,
): currency is CurrencyCode =>
  !!currency && supportedCurrencies.includes(currency as CurrencyCode);

export const normalizeCurrencyCode = (currency?: string): CurrencyCode =>
  isSupportedCurrency(currency)
    ? (currency as CurrencyCode)
    : BASE_CURRENCY_CODE;

export const toCurrencyNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getCurrencyApiKey = async (): Promise<string | undefined> => {
  if (process.env.CURRENCY_API_KEY) {
    return process.env.CURRENCY_API_KEY;
  }

  if (!CURRENCY_API_SECRET_ARN) {
    return undefined;
  }

  if (cachedSecret && cachedSecret.expiresAt > now()) {
    return cachedSecret.value;
  }

  const response = await secretsClient.send(
    new GetSecretValueCommand({
      SecretId: CURRENCY_API_SECRET_ARN,
    }),
  );

  const secretValue =
    response.SecretString ??
    (response.SecretBinary
      ? Buffer.from(response.SecretBinary as Uint8Array).toString('utf-8')
      : undefined);

  if (!secretValue) {
    throw new Error('Currency API secret is empty');
  }

  cachedSecret = {
    value: secretValue,
    expiresAt: now() + SECRET_CACHE_TTL_MS,
  };

  return secretValue;
};

async function fetchRate(
  from: CurrencyCode,
  to: CurrencyCode,
): Promise<ExchangeRateSnapshot> {
  if (from === to) {
    return {
      fromCurrency: from,
      toCurrency: to,
      rate: 1,
      provider: RATE_PROVIDER,
      capturedAt: new Date().toISOString(),
    };
  }

  const key = cacheKey(from, to);
  const cached = rateCache.get(key);
  if (cached && cached.expiresAt > now()) {
    return cached.snapshot;
  }

  const apiKey = await getCurrencyApiKey();
  const url = new URL(CURRENCY_API_URL);
  url.searchParams.set('base_currency', from);
  url.searchParams.set('currencies', to);
  if (apiKey && !url.searchParams.has('apikey')) {
    url.searchParams.set('apikey', apiKey);
  }

  const response = await fetch(url, {
    headers: apiKey
      ? {
          apikey: apiKey,
        }
      : undefined,
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch exchange rate ${from}->${to}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as {
    data?: Record<string, { value: number }>;
  };

  const rate = payload.data?.[to]?.value;
  if (typeof rate !== 'number') {
    throw new Error(`Exchange rate not found for ${from}->${to}`);
  }

  const snapshot: ExchangeRateSnapshot = {
    fromCurrency: from,
    toCurrency: to,
    rate,
    provider: RATE_PROVIDER,
    capturedAt: new Date().toISOString(),
  };

  rateCache.set(key, {
    snapshot,
    expiresAt: now() + CACHE_TTL_MS,
  });

  return snapshot;
}

export const BASE_CURRENCY_CODE = BASE_CURRENCY_ENV;

export const getSupportedCurrencies = () => supportedCurrencies;

export async function convertAmount(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
) {
  const snapshot = await fetchRate(from, to);
  return {
    amount: Number((amount * snapshot.rate).toFixed(2)),
    snapshot,
  };
}

export async function convertToBaseCurrency(
  amount: number,
  currency: CurrencyCode,
) {
  const { amount: baseAmount, snapshot } = await convertAmount(
    amount,
    currency,
    BASE_CURRENCY_CODE,
  );
  return {
    baseAmount,
    snapshot,
  };
}

export async function convertFromBaseCurrency(
  baseAmount: number,
  targetCurrency: CurrencyCode,
) {
  const { amount, snapshot } = await convertAmount(
    baseAmount,
    BASE_CURRENCY_CODE,
    targetCurrency,
  );
  return {
    amount,
    snapshot,
  };
}
