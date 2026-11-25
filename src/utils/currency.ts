import { getLocales } from 'expo-localization';

export const SUPPORTED_CURRENCIES = [
  'AUD',
  'USD',
  'EUR',
  'GBP',
  'INR',
  'NZD',
  'CAD',
  'SGD',
  'JPY',
  'CNY',
  'HKD',
  'AED',
  'CHF',
  'ZAR',
  'MYR',
  'THB',
  'IDR',
  'PHP',
  'KRW',
  'SAR',
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

const REGION_CURRENCY: Record<string, CurrencyCode> = {
  AU: 'AUD',
  US: 'USD',
  GB: 'GBP',
  IN: 'INR',
  NZ: 'NZD',
  CA: 'CAD',
  SG: 'SGD',
  JP: 'JPY',
  CN: 'CNY',
  HK: 'HKD',
  AE: 'AED',
  CH: 'CHF',
  ZA: 'ZAR',
  MY: 'MYR',
  TH: 'THB',
  ID: 'IDR',
  PH: 'PHP',
  KR: 'KRW',
  SA: 'SAR',
  AT: 'EUR',
  BE: 'EUR',
  CY: 'EUR',
  DE: 'EUR',
  EE: 'EUR',
  ES: 'EUR',
  FI: 'EUR',
  FR: 'EUR',
  GR: 'EUR',
  IE: 'EUR',
  IT: 'EUR',
  LT: 'EUR',
  LU: 'EUR',
  LV: 'EUR',
  MT: 'EUR',
  NL: 'EUR',
  PT: 'EUR',
  SI: 'EUR',
  SK: 'EUR',
};

export function normalizeCurrency(value?: string | null): CurrencyCode {
  const code = value?.toUpperCase();
  return SUPPORTED_CURRENCIES.includes(code as CurrencyCode)
    ? (code as CurrencyCode)
    : 'AUD';
}

export function deviceCurrency(): CurrencyCode {
  const locale = getLocales()[0];
  if (locale?.currencyCode) return normalizeCurrency(locale.currencyCode);
  return normalizeCurrency(locale?.regionCode ? REGION_CURRENCY[locale.regionCode] : null);
}

export function formatCurrency(amount: number, currency: string): string {
  const code = normalizeCurrency(currency);
  return `${code} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

