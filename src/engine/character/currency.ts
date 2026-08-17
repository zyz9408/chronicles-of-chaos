export interface CurrencyLabels {
  coin: string;
  string: string;
}

export const defaultCurrencyLabels: CurrencyLabels = {
  coin: '钱',
  string: '贯',
};

export const COINS_PER_STRING = 1000;

export function formatCurrency(amountInCoins: number, labels: CurrencyLabels = defaultCurrencyLabels): string {
  let remaining = Math.max(0, Math.floor(amountInCoins));
  const strings = Math.floor(remaining / COINS_PER_STRING);
  remaining -= strings * COINS_PER_STRING;

  const parts: string[] = [];
  if (strings > 0) parts.push(`${strings}${labels.string}`);
  if (remaining > 0 || parts.length === 0) parts.push(`${remaining}${labels.coin}`);
  return parts.join('');
}
