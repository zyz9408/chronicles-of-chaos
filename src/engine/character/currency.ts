export interface CurrencyLabels {
  coin: string;
  string: string;
  gold: string;
}

export const defaultCurrencyLabels: CurrencyLabels = {
  coin: '钱',
  string: '贯',
  gold: '金',
};

export const COINS_PER_STRING = 1000;
export const STRINGS_PER_GOLD = 10;
export const COINS_PER_GOLD = COINS_PER_STRING * STRINGS_PER_GOLD;

export function formatCurrency(amountInCoins: number, labels: CurrencyLabels = defaultCurrencyLabels): string {
  let remaining = Math.max(0, Math.floor(amountInCoins));
  const gold = Math.floor(remaining / COINS_PER_GOLD);
  remaining -= gold * COINS_PER_GOLD;
  const strings = Math.floor(remaining / COINS_PER_STRING);
  remaining -= strings * COINS_PER_STRING;

  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold}${labels.gold}`);
  if (strings > 0) parts.push(`${strings}${labels.string}`);
  if (remaining > 0 || parts.length === 0) parts.push(`${remaining}${labels.coin}`);
  return parts.join('');
}
