const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export const parseLimit = (rawLimit: string | undefined): number => {
  if (!rawLimit) {
    return DEFAULT_LIMIT;
  }

  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
    throw new Error(
      `Invalid limit. Expected an integer between 1 and ${MAX_LIMIT}.`,
    );
  }

  return limit;
};
