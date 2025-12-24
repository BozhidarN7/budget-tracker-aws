export type CurrencyCode = 'EUR' | 'BGN' | 'USD' | 'GBP';

export interface ExchangeRateSnapshot {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: number;
  provider: string;
  capturedAt: string;
}

export interface Transaction {
  id: string;
  description: string;
  amount: number; // value returned to the client in the user preferred currency
  currency: CurrencyCode; // currency that matches the exposed "amount"
  baseAmount?: number; // canonical amount stored in DynamoDB (EUR)
  baseCurrency?: CurrencyCode;
  originalAmount?: number;
  originalCurrency?: CurrencyCode;
  displayAmount?: number;
  displayCurrency?: CurrencyCode;
  exchangeRateSnapshot?: ExchangeRateSnapshot;
  date: string;
  category: string;
  type: 'income' | 'expense';
  userId: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  type: 'income' | 'expense';
  currency?: CurrencyCode; // last requested display currency
  baseCurrency?: CurrencyCode; // canonical currency (EUR)
  monthlyData: {
    [month: string]: {
      limit: number; // stored in base currency
      spent: number; // stored in base currency
      displayLimit?: number; // dynamically calculated for responses
      displaySpent?: number;
      currency?: CurrencyCode;
    };
  }; // e.g., { "2025-05": { limit: 200, spent: 120 } }
  userId: string;
}

export interface Goal {
  id: string;
  name: string;
  target: number; // stored in base currency
  current: number; // stored in base currency
  currency?: CurrencyCode; // currency exposed to the client
  baseCurrency?: CurrencyCode;
  displayTarget?: number;
  displayCurrent?: number;
  exchangeRateSnapshot?: ExchangeRateSnapshot;
  targetDate: string;
  description: string;
  userId: string;
}

export interface UserPreference {
  userId: string;
  preferredCurrency: CurrencyCode;
  updatedAt: string;
}
