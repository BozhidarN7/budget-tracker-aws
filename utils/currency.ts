import type { CurrencyCode, ExchangeRateSnapshot } from '../types/budget';
import {
  BASE_CURRENCY_CODE,
  CACHE_TTL_MS,
  CURRENCY_API_URL,
  RATE_PROVIDER,
  getSupportedCurrencies as getConfiguredCurrencies,
  getCurrencyApiKey,
} from './currency-config';
import { getPersistedRate, putPersistedRate } from './rates-store';

export {
  refreshAllRates,
  type RefreshRatesOptions,
  type RefreshRatesResult,
  getLastRefreshEpoch,
} from './rates-store';
export {
  BASE_CURRENCY_CODE,
  isSupportedCurrency,
  normalizeCurrencyCode,
} from './currency-config';

type RateCacheEntry = {
  snapshot: ExchangeRateSnapshot;
  expiresAt: number;
};

const rateCache = new Map<string, RateCacheEntry>();
const cacheKey = (from: CurrencyCode, to: CurrencyCode) => `${from}:${to}`;
const supportedCurrencies = getConfiguredCurrencies();
const now = () => Date.now();

export interface RateContext {
  getSnapshot: (
    from: CurrencyCode,
    to: CurrencyCode,
  ) => Promise<ExchangeRateSnapshot>;
}

export const getSupportedCurrencyCodes = () => supportedCurrencies;

export const toCurrencyNumber = (value: unknown): number => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function createSnapshotGetter() {
  const pending = new Map<string, Promise<ExchangeRateSnapshot>>();

  return async function getSnapshot(
    from: CurrencyCode,
    to: CurrencyCode,
  ): Promise<ExchangeRateSnapshot> {
    const key = cacheKey(from, to);
    const cached = rateCache.get(key);
    if (cached && cached.expiresAt > now()) {
      return cached.snapshot;
    }

    const inFlight = pending.get(key);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = fetchRate(from, to).finally(() => {
      pending.delete(key);
    });

    pending.set(key, fetchPromise);
    return fetchPromise;
  };
}

const defaultGetSnapshot = createSnapshotGetter();

export function createRateContext(): RateContext {
  return {
    getSnapshot: createSnapshotGetter(),
  };
}

const getSnapshot = (
  from: CurrencyCode,
  to: CurrencyCode,
  context?: RateContext,
) => (context ? context.getSnapshot(from, to) : defaultGetSnapshot(from, to));

const rememberRate = (snapshot: ExchangeRateSnapshot) => {
  rateCache.set(cacheKey(snapshot.fromCurrency, snapshot.toCurrency), {
    snapshot,
    expiresAt: now() + CACHE_TTL_MS,
  });
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
  const nowMs = now();
  if (cached && cached.expiresAt > nowMs) {
    return cached.snapshot;
  }

  const persisted = await getPersistedRate(from, to);
  if (
    persisted?.freshUntilEpoch !== undefined &&
    persisted.freshUntilEpoch > nowMs
  ) {
    const freshSnapshot = { ...persisted.snapshot, stale: false };
    rememberRate(freshSnapshot);
    return freshSnapshot;
  }

  const apiKey = await getCurrencyApiKey();
  const url = new URL(CURRENCY_API_URL);
  url.searchParams.set('base_currency', from);
  url.searchParams.set('currencies', to);
  if (apiKey && !url.searchParams.has('apikey')) {
    url.searchParams.set('apikey', apiKey);
  }

  try {
    const response = await fetch(url);
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
      stale: false,
    };

    rememberRate(snapshot);
    await putPersistedRate(snapshot);
    return snapshot;
  } catch (err) {
    if (persisted?.snapshot) {
      const fallback: ExchangeRateSnapshot = {
        ...persisted.snapshot,
        stale: true,
      };
      rememberRate(fallback);
      return fallback;
    }
    throw err;
  }
}

export const getSupportedCurrencies = () => supportedCurrencies;

export async function convertAmount(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rateContext?: RateContext,
) {
  const snapshot = await getSnapshot(from, to, rateContext);
  return {
    amount: Number((amount * snapshot.rate).toFixed(2)),
    snapshot,
  };
}

export async function convertToBaseCurrency(
  amount: number,
  currency: CurrencyCode,
  rateContext?: RateContext,
) {
  const { amount: baseAmount, snapshot } = await convertAmount(
    amount,
    currency,
    BASE_CURRENCY_CODE,
    rateContext,
  );
  return {
    baseAmount,
    snapshot,
  };
}

export async function convertFromBaseCurrency(
  baseAmount: number,
  targetCurrency: CurrencyCode,
  rateContext?: RateContext,
) {
  const { amount, snapshot } = await convertAmount(
    baseAmount,
    BASE_CURRENCY_CODE,
    targetCurrency,
    rateContext,
  );
  return {
    amount,
    snapshot,
  };
}
