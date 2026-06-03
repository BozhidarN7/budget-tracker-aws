export const environments = {
  dev: {
    allowOrigins: ['https://localhost:3000'],
    baseCurrency: 'EUR',
    supportedCurrencies: 'EUR,BGN,USD,GBP',
    currencyApi: {
      url: 'https://api.currencyapi.com/v3/latest',
      secretArn:
        'arn:aws:secretsmanager:eu-central-1:967206684166:secret:CURRENCYAPI_KEY-W7IY2B',
    },
    currencyRates: {
      persistedFreshMs: 24 * 60 * 60 * 1000,
      persistedTtlDays: 30,
    },
    ratesAdminGroup: 'rates-admins',
  },

  prod: {
    allowOrigins: [
      'https://localhost:3000',
      'https://budget-tracker-5onkq23od-bozhidarn7s-projects.vercel.app',
      'https://budget-tracker-henna-phi.vercel.app',
    ],
    baseCurrency: 'EUR',
    supportedCurrencies: 'EUR,BGN,USD,GBP',
    currencyApi: {
      url: 'https://api.currencyapi.com/v3/latest',
      secretArn:
        'arn:aws:secretsmanager:eu-central-1:967206684166:secret:CURRENCYAPI_KEY-W7IY2B',
    },
    currencyRates: {
      persistedFreshMs: 24 * 60 * 60 * 1000,
      persistedTtlDays: 30,
    },
    ratesAdminGroup: 'rates-admins',
  },
};
