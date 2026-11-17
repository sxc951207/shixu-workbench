const locale = 'zh-CN';
const percent = new Intl.NumberFormat(locale, {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const decimals = new Map<number, Intl.NumberFormat>();

export function formatOperatingDecimal(value: number, digits = 2): string {
  let format = decimals.get(digits);
  if (!format) {
    format = new Intl.NumberFormat(locale, {minimumFractionDigits: digits, maximumFractionDigits: digits});
    decimals.set(digits, format);
  }
  return format.format(value);
}

/** Accept the unrounded fraction, before multiplication by 100 for a chart coordinate. */
export function formatOperatingPercent(fraction: number): string {
  return percent.format(fraction);
}
