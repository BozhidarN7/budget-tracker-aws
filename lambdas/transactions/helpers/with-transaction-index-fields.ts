import { buildDateKey } from '../../../utils/build-date-key';

export const withTransactionIndexFields = (
  transaction: Record<string, unknown>,
): Record<string, unknown> => {
  const id = transaction.id;
  const date = transaction.date;

  if (typeof id !== 'string' || typeof date !== 'string') {
    throw new Error('Transaction id and date are required');
  }

  return {
    ...transaction,
    dateKey: buildDateKey(date, id),
  };
};
