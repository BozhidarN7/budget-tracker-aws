import { StackProps } from 'aws-cdk-lib';

export interface BudgetTrackerStackProps extends StackProps {
  baseCurrency: string;
  supportedCurrencies: string;
  currencyApi: {
    url: string;
    secretArn: string;
  };
  currencyRates: {
    persistedFreshMs: number;
    persistedTtlDays: number;
  };
  ratesAdminGroup: string;
}
