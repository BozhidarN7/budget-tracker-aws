export const encodeCursor = (
  lastEvaluatedKey: Record<string, unknown>,
): string =>
  Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64url');

export const decodeCursor = (
  cursor: string | undefined,
): Record<string, unknown> | undefined => {
  if (!cursor) {
    return undefined;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    if (
      typeof decoded.id !== 'string' ||
      typeof decoded.userId !== 'string' ||
      typeof decoded.dateKey !== 'string'
    ) {
      throw new Error('Invalid cursor shape');
    }

    return decoded;
  } catch {
    throw new Error('Invalid cursor');
  }
};
