const allowedOrigins = [
  'https://localhost:3000',
  'https://budget-tracker-5onkq23od-bozhidarn7s-projects.vercel.app',
  'https://budget-tracker-henna-phi.vercel.app',
];

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
