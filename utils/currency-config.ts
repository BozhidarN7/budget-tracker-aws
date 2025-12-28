import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import type { CurrencyCode } from '../types/budget';

const secretsClient = new SecretsManagerClient({});
const SECRET_CACHE_TTL_MS = Number(
  process.env.CURRENCY_SECRET_CACHE_TTL_MS ?? 5 * 60 * 1000,
);

export const BASE_CURRENCY_CODE =
  (process.env.BASE_CURRENCY as CurrencyCode) || 'EUR';
const SUPPORTED_CURRENCIES_ENV =
  process.env.SUPPORTED_CURRENCIES || BASE_CURRENCY_CODE;
export const SUPPORTED_CURRENCIES = SUPPORTED_CURRENCIES_ENV.split(',')
  .map((currency) => currency.trim())
  .filter(Boolean) as CurrencyCode[];
export const RATE_PROVIDER =
  process.env.CURRENCY_RATE_PROVIDER || 'currencyapi.com';
export const CURRENCY_API_URL =
  process.env.CURRENCY_API_URL || 'https://api.currencyapi.com/v3/latest';
export const CURRENCY_API_SECRET_ARN = process.env.CURRENCY_API_SECRET_ARN;
export const CACHE_TTL_MS = Number(
  process.env.CURRENCY_CACHE_TTL_MS ?? 5 * 60 * 1000,
);

let cachedSecret: { value: string; expiresAt: number } | null = null;

export const now = () => Date.now();

export const getSupportedCurrencies = () => SUPPORTED_CURRENCIES;

export const isSupportedCurrency = (
  currency?: string,
): currency is CurrencyCode =>
  !!currency && SUPPORTED_CURRENCIES.includes(currency as CurrencyCode);

export const normalizeCurrencyCode = (currency?: string): CurrencyCode =>
  isSupportedCurrency(currency)
    ? (currency as CurrencyCode)
    : BASE_CURRENCY_CODE;

export const getCurrencyApiKey = async (): Promise<string | undefined> => {
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
    new GetSecretValueCommand({ SecretId: CURRENCY_API_SECRET_ARN }),
  );

  const secretValue =
    JSON.parse(response.SecretString ?? '').CURRENCY_API_KEY ??
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
