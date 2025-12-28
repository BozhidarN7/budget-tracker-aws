export const environments = {
  dev: {
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
