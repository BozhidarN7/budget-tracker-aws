import {
  advanceOccurrencePointer,
  buildInitialNextOccurrence,
  computeNextOccurrence,
  getNextOccurrence,
  getStatusForOccurrence,
  isDueInUserTimezone,
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

describe('timezone-aware recurrence helpers', () => {
  const makeRule = (overrides: Partial<RecurringRule>) =>
    ({
      frequency: 'monthly',
      startDate: '2026-01-31',
      ...overrides,
    }) as RecurringRule;
  const sofia = 'Europe/Sofia';
  const utc = 'UTC';

  it('isDueInUserTimezone detects due using user local midnight', () => {
    const occurrence = '2026-05-28';
    const justBeforeLocalMidnight = new Date('2026-05-27T20:59:59Z');
    const atLocalMidnight = new Date('2026-05-27T21:00:00Z');
    expect(
      isDueInUserTimezone(occurrence, sofia, justBeforeLocalMidnight),
    ).toBe(false);
    expect(isDueInUserTimezone(occurrence, sofia, atLocalMidnight)).toBe(true);
    expect(
      isDueInUserTimezone(occurrence, sofia, new Date('2026-05-28T10:00:00Z')),
    ).toBe(true);
  });

  it('isDueInUserTimezone behaves as UTC default when no tz specified (compat)', () => {
    const occurrence = '2026-01-10';
    expect(
      isDueInUserTimezone(occurrence, utc, new Date('2026-01-09T23:59:59Z')),
    ).toBe(false);
    expect(
      isDueInUserTimezone(occurrence, utc, new Date('2026-01-10T00:00:00Z')),
    ).toBe(true);
  });

  it('computeNextOccurrence respects tz for target date when tz passed', () => {
    const rule = makeRule({ frequency: 'weekly', startDate: '2026-01-01' });
    const serverNowUtcDay = new Date('2026-01-09T20:00:00Z');
    expect(computeNextOccurrence(rule, serverNowUtcDay)).toBe('2026-01-15');
    expect(computeNextOccurrence(rule, serverNowUtcDay, sofia)).toBe(
      '2026-01-15',
    );
  });

  it('advanceOccurrencePointer advances using pure rule', () => {
    const rule = makeRule({
      frequency: 'monthly',
      startDate: '2026-01-31',
      dayOfMonth: 31,
    });
    expect(advanceOccurrencePointer(rule, '2026-01-31')).toBe('2026-02-28');
    expect(advanceOccurrencePointer(rule, '2026-02-28')).toBe('2026-03-31');
  });
});
