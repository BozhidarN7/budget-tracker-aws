const buildResponse = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    'Access-Control-Allow-Origin': 'https://localhost:3000',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'OPTIONS,GET,POST,PUT,DELETE',
  },
  body: JSON.stringify(body),
});

export default buildResponse;
