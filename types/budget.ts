export type CurrencyCode = 'EUR' | 'BGN' | 'USD' | 'GBP';

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface RecurringRule {
  frequency: RecurringFrequency;
  interval?: number;
  startDate: string; // yyyy-MM-dd
  endDate?: string; // yyyy-MM-dd
  dayOfMonth?: number; // 1..31 for monthly
}

export type RecurringStatus = 'active' | 'paused' | 'completed';

export interface ExchangeRateSnapshot {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: number;
  provider: string;
  capturedAt: string;
  stale?: boolean;
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

export interface CategoryMonthlyEntry {
  limit: number; // legacy amount stored in original currency
  spent: number; // legacy amount stored in original currency
  baseSpent: number;
  baseLimit: number;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  type: 'income' | 'expense';
  currency?: CurrencyCode; // last requested display currency
  baseCurrency?: CurrencyCode; // canonical currency (EUR)
  monthlyData: {
    [month: string]: CategoryMonthlyEntry;
  }; // e.g., { "2025-05": { limit: 200, spent: 120 } }
  userId: string;
}

export type CategoryResponseMonthlyEntry = {
  limit: number; // exposed to the client in its preferred currency
  spent: number;
};

export type CategoryResponse = Omit<Category, 'monthlyData'> & {
  monthlyData: {
    [month: string]: CategoryResponseMonthlyEntry;
  };
};

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

export interface RecurringTransaction {
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
  category: string;
  type: 'income' | 'expense';
  rule: RecurringRule;
  nextOccurrence: string; // yyyy-MM-dd
  status: RecurringStatus;
  userId: string;
}
