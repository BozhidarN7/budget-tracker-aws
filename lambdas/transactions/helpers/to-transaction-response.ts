import {
  BASE_CURRENCY_CODE,
  convertFromBaseCurrency,
  toCurrencyNumber,
} from '../../../utils';
import type { RateContext } from '../../../utils';
import type { CurrencyCode, Transaction } from '../../../types/budget';

export const toTransactionResponse = async (
  item: Record<string, unknown>,
  preferredCurrency: CurrencyCode,
  rateContext: RateContext,
): Promise<Transaction> => {
  const baseAmount = toCurrencyNumber(item.baseAmount ?? item.amount ?? 0);
  const baseCurrency =
    (item.baseCurrency as CurrencyCode) || BASE_CURRENCY_CODE;
  const typedItem = item as unknown as Transaction;
  const originalAmount = typedItem.originalAmount ?? baseAmount;
  const originalCurrency =
    (typedItem.originalCurrency as CurrencyCode) ?? baseCurrency;

  if (preferredCurrency === baseCurrency) {
    return {
      ...typedItem,
      amount: baseAmount,
      currency: baseCurrency,
      baseAmount,
      baseCurrency,
      originalAmount,
      originalCurrency,
      displayAmount: baseAmount,
      displayCurrency: baseCurrency,
      exchangeRateSnapshot: typedItem.exchangeRateSnapshot,
    };
  }

  const { amount: convertedAmount, snapshot } = await convertFromBaseCurrency(
    baseAmount,
    preferredCurrency,
    rateContext,
  );

  return {
    ...typedItem,
    amount: convertedAmount,
    currency: preferredCurrency,
    baseAmount,
    baseCurrency,
    originalAmount,
    originalCurrency,
    displayAmount: convertedAmount,
    displayCurrency: preferredCurrency,
    exchangeRateSnapshot: snapshot,
  };
};
