import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import type { CurrencyCode, ExchangeRateSnapshot } from '../types/budget';
import {
  CURRENCY_API_URL,
  RATE_PROVIDER,
  getCurrencyApiKey,
  getSupportedCurrencies,
  now,
} from './currency-config';

const RATES_TABLE_NAME = process.env.RATES_TABLE_NAME;
const CURRENCY_PERSISTED_FRESH_MS = Number(
  process.env.CURRENCY_PERSISTED_FRESH_MS ?? 24 * 60 * 60 * 1000,
);
const CURRENCY_PERSISTED_TTL_DAYS = Number(
  process.env.CURRENCY_PERSISTED_TTL_DAYS ?? 30,
);
const PERSISTED_TTL_MS = CURRENCY_PERSISTED_TTL_DAYS * 24 * 60 * 60 * 1000;
const META_PARTITION_KEY = '__meta__';
const META_SORT_KEY = 'snapshot';
const dynamoClient = RATES_TABLE_NAME ? new DynamoDBClient({}) : null;

type PersistedRateRecord = {
  fromCurrency: string;
  toCurrency: string;
  rate?: number;
  provider?: string;
  capturedAt?: string;
  freshUntilEpoch?: number;
  ttlEpoch?: number;
  stale?: boolean;
};

type MetaRecord = {
  lastRefreshEpoch?: number;
  lastManualRefreshEpoch?: number;
};

const dynamoEnabled = () => Boolean(dynamoClient && RATES_TABLE_NAME);

const metaKey = () =>
  marshall({ fromCurrency: META_PARTITION_KEY, toCurrency: META_SORT_KEY });

const toSnapshot = (
  record: PersistedRateRecord,
): ExchangeRateSnapshot | null => {
  if (typeof record.rate !== 'number') {
    return null;
  }
  return {
    fromCurrency: record.fromCurrency as CurrencyCode,
    toCurrency: record.toCurrency as CurrencyCode,
    rate: record.rate,
    provider: record.provider ?? RATE_PROVIDER,
    capturedAt: record.capturedAt ?? new Date(0).toISOString(),
    stale: record.stale,
  };
};

export interface PersistedRateResult {
  snapshot: ExchangeRateSnapshot;
  freshUntilEpoch?: number;
}

export const getPersistedRate = async (
  from: CurrencyCode,
  to: CurrencyCode,
): Promise<PersistedRateResult | null> => {
  if (!dynamoEnabled()) {
    return null;
  }
  const response = await dynamoClient!.send(
    new GetItemCommand({
      TableName: RATES_TABLE_NAME,
      Key: marshall({ fromCurrency: from, toCurrency: to }),
    }),
  );
  if (!response.Item) {
    return null;
  }
  const record = unmarshall(response.Item) as PersistedRateRecord;
  const snapshot = toSnapshot(record);
  if (!snapshot) {
    return null;
  }
  return {
    snapshot,
    freshUntilEpoch:
      typeof record.freshUntilEpoch === 'number'
        ? record.freshUntilEpoch
        : undefined,
  };
};

export const putPersistedRate = async (snapshot: ExchangeRateSnapshot) => {
  if (!dynamoEnabled()) {
    return;
  }
  const capturedAtMs = Date.parse(snapshot.capturedAt) || now();
  const freshUntilEpoch = capturedAtMs + CURRENCY_PERSISTED_FRESH_MS;
  const ttlEpoch = Math.floor((capturedAtMs + PERSISTED_TTL_MS) / 1000);
  await dynamoClient!.send(
    new PutItemCommand({
      TableName: RATES_TABLE_NAME,
      Item: marshall({
        fromCurrency: snapshot.fromCurrency,
        toCurrency: snapshot.toCurrency,
        rate: snapshot.rate,
        provider: snapshot.provider,
        capturedAt: snapshot.capturedAt,
        freshUntilEpoch,
        ttlEpoch,
        stale: snapshot.stale ?? false,
      }),
    }),
  );
};

const getMetaRecord = async (): Promise<MetaRecord | null> => {
  if (!dynamoEnabled()) {
    return null;
  }
  const response = await dynamoClient!.send(
    new GetItemCommand({ TableName: RATES_TABLE_NAME, Key: metaKey() }),
  );
  if (!response.Item) {
    return null;
  }
  return unmarshall(response.Item) as MetaRecord;
};

const setLastRefreshEpoch = async (epoch: number, manual?: boolean) => {
  if (!dynamoEnabled()) {
    return;
  }
  await dynamoClient!.send(
    new PutItemCommand({
      TableName: RATES_TABLE_NAME,
      Item: marshall({
        fromCurrency: META_PARTITION_KEY,
        toCurrency: META_SORT_KEY,
        lastRefreshEpoch: epoch,
        ...(manual ? { lastManualRefreshEpoch: epoch } : {}),
      }),
    }),
  );
};

export const getLastRefreshEpoch = async () => {
  const meta = await getMetaRecord();
  return meta?.lastRefreshEpoch ?? null;
};

const fetchBatchRates = async (
  base: CurrencyCode,
  targets: CurrencyCode[],
  apiKey?: string,
) => {
  const url = new URL(CURRENCY_API_URL);
  url.searchParams.set('base_currency', base);
  url.searchParams.set('currencies', targets.join(','));
  if (apiKey && !url.searchParams.has('apikey')) {
    url.searchParams.set('apikey', apiKey);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to refresh batch for ${base}: ${response.status} ${response.statusText}`,
    );
  }
  const payload = (await response.json()) as {
    data?: Record<string, { value: number }>;
  };
  const capturedAt = new Date().toISOString();
  const rates: Record<string, number> = {};
  targets.forEach((target) => {
    const value = payload.data?.[target]?.value;
    if (typeof value !== 'number') {
      throw new Error(`Exchange rate not found for ${base}->${target}`);
    }
    rates[target] = value;
  });
  return { rates, capturedAt };
};

export interface RefreshRatesOptions {
  force?: boolean;
}

export interface RefreshRatesResult {
  refreshed: boolean;
  updatedPairs: number;
  lastRefreshEpoch: number;
  nextAllowedRefreshEpoch: number;
  skippedReason?: 'fresh';
}

export const refreshAllRates = async (
  options: RefreshRatesOptions = {},
  onSnapshot?: (snapshot: ExchangeRateSnapshot) => void,
): Promise<RefreshRatesResult> => {
  if (!dynamoEnabled()) {
    throw new Error('RATES_TABLE_NAME is not configured');
  }
  const nowMs = now();
  const lastRefreshEpoch = (await getLastRefreshEpoch()) ?? 0;
  const nextAllowed = lastRefreshEpoch + CURRENCY_PERSISTED_FRESH_MS;
  if (!options.force && lastRefreshEpoch && nowMs < nextAllowed) {
    return {
      refreshed: false,
      updatedPairs: 0,
      lastRefreshEpoch,
      nextAllowedRefreshEpoch: nextAllowed,
      skippedReason: 'fresh',
    };
  }

  const apiKey = await getCurrencyApiKey();
  const bases = getSupportedCurrencies();
  let updatedPairs = 0;
  for (const base of bases) {
    const targets = bases.filter((currency) => currency !== base);
    if (!targets.length) {
      continue;
    }
    const { rates, capturedAt } = await fetchBatchRates(base, targets, apiKey);
    await Promise.all(
      Object.entries(rates).map(async ([target, value]) => {
        const snapshot: ExchangeRateSnapshot = {
          fromCurrency: base,
          toCurrency: target as CurrencyCode,
          rate: value,
          provider: RATE_PROVIDER,
          capturedAt,
          stale: false,
        };
        await putPersistedRate(snapshot);
        onSnapshot?.(snapshot);
      }),
    );
    updatedPairs += targets.length;
  }

  await setLastRefreshEpoch(nowMs, options.force);

  return {
    refreshed: true,
    updatedPairs,
    lastRefreshEpoch: nowMs,
    nextAllowedRefreshEpoch: nowMs + CURRENCY_PERSISTED_FRESH_MS,
  };
};
