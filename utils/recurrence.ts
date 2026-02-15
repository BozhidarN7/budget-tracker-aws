import type {
  RecurringFrequency,
  RecurringRule,
  RecurringStatus,
} from '../types/budget';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const toDate = (value: string) => new Date(`${value}T00:00:00Z`);

const formatDate = (value: Date) => value.toISOString().slice(0, 10);

const daysInMonth = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

const clampDay = (year: number, monthIndex: number, day: number) =>
  Math.min(day, daysInMonth(year, monthIndex));

const alignMonthlyDay = (base: Date, dayOfMonth?: number) => {
  const day = dayOfMonth ?? base.getUTCDate();
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const clamped = clampDay(year, month, day);
  return new Date(Date.UTC(year, month, clamped));
};

const addDaysUtc = (base: Date, days: number) => {
  const copy = new Date(base.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};

const addMonthsUtc = (base: Date, months: number) => {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  const targetMonth = month + months;
  const nextYear = year + Math.floor(targetMonth / 12);
  const nextMonth = ((targetMonth % 12) + 12) % 12;
  const clamped = clampDay(nextYear, nextMonth, day);
  return new Date(Date.UTC(nextYear, nextMonth, clamped));
};

const isValidDateString = (value?: string) =>
  !!value && DATE_REGEX.test(value) && !Number.isNaN(toDate(value).getTime());

const compareDates = (left: string, right: string) =>
  toDate(left).getTime() - toDate(right).getTime();

const getFrequencyDays = (frequency: RecurringFrequency) =>
  frequency === 'biweekly' ? 14 : 7;

const getInterval = (rule: RecurringRule) =>
  typeof rule.interval === 'number' && rule.interval > 0 ? rule.interval : 1;

export const normalizeRecurringRule = (rule: RecurringRule): RecurringRule => {
  const dayOfMonth =
    rule.frequency === 'monthly'
      ? (rule.dayOfMonth ?? toDate(rule.startDate).getUTCDate())
      : undefined;
  return {
    ...rule,
    dayOfMonth,
  };
};

export const validateRecurringRule = (rule: RecurringRule) => {
  if (!['weekly', 'biweekly', 'monthly'].includes(rule.frequency)) {
    throw new Error('Unsupported recurrence frequency');
  }
  if (!isValidDateString(rule.startDate)) {
    throw new Error('Invalid recurrence startDate');
  }
  if (rule.endDate && !isValidDateString(rule.endDate)) {
    throw new Error('Invalid recurrence endDate');
  }
  if (rule.endDate && compareDates(rule.endDate, rule.startDate) < 0) {
    throw new Error('recurrence endDate must be after startDate');
  }
  if (rule.frequency === 'monthly') {
    const day = rule.dayOfMonth ?? toDate(rule.startDate).getUTCDate();
    if (day < 1 || day > 31) {
      throw new Error('recurrence dayOfMonth must be between 1 and 31');
    }
  }
};

export const buildInitialNextOccurrence = (rule: RecurringRule) => {
  const start = toDate(rule.startDate);
  if (rule.frequency === 'monthly') {
    return formatDate(alignMonthlyDay(start, rule.dayOfMonth));
  }
  return formatDate(start);
};

export const getNextOccurrence = (rule: RecurringRule, fromDate: string) => {
  const base = toDate(fromDate);
  switch (rule.frequency) {
    case 'weekly':
    case 'biweekly':
      return formatDate(
        addDaysUtc(base, getFrequencyDays(rule.frequency) * getInterval(rule)),
      );
    case 'monthly': {
      const nextBase = addMonthsUtc(base, getInterval(rule));
      return formatDate(alignMonthlyDay(nextBase, rule.dayOfMonth));
    }
    default:
      return formatDate(addMonthsUtc(base, 1));
  }
};

export const computeNextOccurrence = (
  rule: RecurringRule,
  fromDate = new Date(),
) => {
  let pointer = buildInitialNextOccurrence(rule);
  const target = formatDate(fromDate);

  while (compareDates(pointer, target) < 0) {
    pointer = getNextOccurrence(rule, pointer);
  }

  return pointer;
};

export const getStatusForOccurrence = (
  nextOccurrence: string,
  endDate?: string,
): RecurringStatus => {
  if (endDate && compareDates(nextOccurrence, endDate) > 0) {
    return 'completed';
  }
  return 'active';
};
