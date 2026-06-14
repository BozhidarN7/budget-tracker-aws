export default function parseMonthQuery(
  monthParam?: string,
  yearParam?: string,
): { monthPrefix?: string } {
  if (!monthParam) {
    if (yearParam) {
      throw new Error('Year cannot be provided without month');
    }

    return {};
  }

  const month = Number.parseInt(monthParam, 10);
  if (
    !Number.isInteger(month) ||
    `${month}` !== monthParam ||
    month < 1 ||
    month > 12
  ) {
    throw new Error('Month must be an integer between 1 and 12');
  }

  const resolvedYear = yearParam ?? `${new Date().getFullYear()}`;
  const year = Number.parseInt(resolvedYear, 10);
  if (!Number.isInteger(year) || `${year}` !== resolvedYear) {
    throw new Error('Year must be a valid integer');
  }

  return {
    monthPrefix: `${year}-${String(month).padStart(2, '0')}-`,
  };
}
