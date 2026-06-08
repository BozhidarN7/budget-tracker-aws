import {
  BASE_CURRENCY_CODE,
  convertToBaseCurrency,
  normalizeCurrencyCode,
  toCurrencyNumber,
} from '../../../utils';
import type { RateContext } from '../../../utils';

export const normalizeTransactionInput = async (
  payload: Record<string, unknown>,
  rateContext: RateContext,
): Promise<Record<string, unknown>> => {
  const originalCurrency = normalizeCurrencyCode(payload.currency as string);
  const originalAmount = toCurrencyNumber(payload.amount);

  const { baseAmount, snapshot } = await convertToBaseCurrency(
    originalAmount,
    originalCurrency,
    rateContext,
  );

  return {
    ...payload,
    amount: baseAmount,
    currency: BASE_CURRENCY_CODE,
    baseAmount,
    baseCurrency: BASE_CURRENCY_CODE,
    originalAmount,
    originalCurrency,
    exchangeRateSnapshot: snapshot,
  };
};
