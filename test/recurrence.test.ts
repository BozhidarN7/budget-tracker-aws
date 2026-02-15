import {
  buildInitialNextOccurrence,
  computeNextOccurrence,
  getNextOccurrence,
  getStatusForOccurrence,
  normalizeRecurringRule,
  validateRecurringRule,
} from '../utils/recurrence';
import type { RecurringRule } from '../types/budget';

describe('recurrence utilities', () => {
  const makeRule = (overrides: Partial<RecurringRule>) =>
    ({
      frequency: 'monthly',
      startDate: '2026-01-31',
      ...overrides,
    }) as RecurringRule;

  it('clamps monthly day-of-month to last day', () => {
    const rule = makeRule({ dayOfMonth: 31 });
    expect(buildInitialNextOccurrence(rule)).toBe('2026-01-31');
    expect(getNextOccurrence(rule, '2026-01-31')).toBe('2026-02-28');
  });

  it('supports leap-year monthly clamping', () => {
    const rule = makeRule({ startDate: '2028-01-31', dayOfMonth: 31 });
    expect(getNextOccurrence(rule, '2028-01-31')).toBe('2028-02-29');
  });

  it('rolls weekly and biweekly forward from past start dates', () => {
    const weekly = makeRule({ frequency: 'weekly', startDate: '2026-01-01' });
    const biweekly = makeRule({
      frequency: 'biweekly',
      startDate: '2026-01-01',
    });
    const fromDate = new Date('2026-01-10T00:00:00Z');

    expect(computeNextOccurrence(weekly, fromDate)).toBe('2026-01-15');
    expect(computeNextOccurrence(biweekly, fromDate)).toBe('2026-01-15');
  });

  it('marks completed when next occurrence exceeds end date', () => {
    expect(getStatusForOccurrence('2026-03-01', '2026-02-28')).toBe(
      'completed',
    );
    expect(getStatusForOccurrence('2026-02-28', '2026-02-28')).toBe('active');
  });

  it('infers monthly day from start date', () => {
    const rule = normalizeRecurringRule(
      makeRule({ startDate: '2026-02-15', dayOfMonth: undefined }),
    );
    expect(rule.dayOfMonth).toBe(15);
  });

  it('validates recurrence rules', () => {
    expect(() =>
      validateRecurringRule(
        makeRule({ frequency: 'monthly', startDate: '2026-02-10' }),
      ),
    ).not.toThrow();
    expect(() =>
      validateRecurringRule(
        makeRule({ frequency: 'monthly', startDate: 'invalid-date' }),
      ),
    ).toThrow('Invalid recurrence startDate');
  });
});
