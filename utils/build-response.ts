const allowedOrigins = (process.env.ALLOW_ORIGINS ?? '')
  .split(',')
  .filter(Boolean);

const buildResponse = (statusCode: number, body: unknown, origin?: string) => {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  };

  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
};

export default buildResponse;
