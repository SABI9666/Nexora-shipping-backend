const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function chunkToWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return TENS[t] + (o ? ' ' + ONES[o] : '');
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return ONES[h] + ' Hundred' + (rest ? ' ' + chunkToWords(rest) : '');
}

function wholeNumberToWords(num: number): string {
  if (num === 0) return 'Zero';
  const parts: string[] = [];
  const billions = Math.floor(num / 1_000_000_000);
  const millions = Math.floor((num % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((num % 1_000_000) / 1_000);
  const rest = num % 1_000;
  if (billions) parts.push(chunkToWords(billions) + ' Billion');
  if (millions) parts.push(chunkToWords(millions) + ' Million');
  if (thousands) parts.push(chunkToWords(thousands) + ' Thousand');
  if (rest) parts.push(chunkToWords(rest));
  return parts.join(' ').trim();
}

export type FractionLabel = { major: string; minor: string };

const CURRENCY_LABELS: Record<string, FractionLabel> = {
  AED: { major: 'AED', minor: 'Fils' },
  USD: { major: 'USD', minor: 'Cents' },
  EUR: { major: 'EUR', minor: 'Cents' },
  GBP: { major: 'GBP', minor: 'Pence' },
  INR: { major: 'INR', minor: 'Paise' },
  SAR: { major: 'SAR', minor: 'Halala' },
};

export function amountToWords(amount: number, currency = 'AED'): string {
  const labels = CURRENCY_LABELS[currency.toUpperCase()] ?? { major: currency.toUpperCase(), minor: 'Cents' };
  const safe = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const whole = Math.floor(safe);
  const fractional = Math.round((safe - whole) * 100);
  const words = wholeNumberToWords(whole);
  const minor = String(fractional).padStart(2, '0');
  return `${labels.major} ${words} and ${labels.minor} ${minor}/100 Only`;
}
