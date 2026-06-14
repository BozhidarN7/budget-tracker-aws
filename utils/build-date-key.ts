const MONTH_INDEX_BY_NAME: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

const toIsoDate = (date: string): string => {
  const match =
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/.exec(
      date,
    );

  if (!match) {
    throw new Error('Transaction date must use the format "Mon D, YYYY"');
  }

  const [, monthName, day, year] = match;
  const month = MONTH_INDEX_BY_NAME[monthName];
  const paddedDay = day.padStart(2, '0');

  return `${year}-${month}-${paddedDay}`;
};

export const buildDateKey = (date: string, id: string): string =>
  `${toIsoDate(date)}#${id}`;
