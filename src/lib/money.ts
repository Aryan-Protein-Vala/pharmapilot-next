// src/lib/money.ts — Strict Paise-safe integer arithmetic & Indian currency formatting

export type Paise = number; // Always integer paise (1 INR = 100 paise)

/**
 * Asserts that the given value is a safe integer representing paise.
 * Throws an error if a floating-point value is accidentally passed.
 */
export function assertIntegerPaise(paise: Paise, label = 'amount'): void {
  if (!Number.isSafeInteger(paise)) {
    throw new Error(`Invalid non-integer paise for ${label}: ${paise}`);
  }
}

/**
 * Converts a rupees input (number or string) to integer paise.
 * Handles strings with currency symbols, commas, decimals, and negative signs.
 * Rounds fractional paise to the nearest integer.
 */
export function rupeesToPaise(rupeesInput: string | number): Paise {
  if (typeof rupeesInput === 'number') {
    if (!Number.isFinite(rupeesInput)) return 0;
    return Math.round(rupeesInput * 100);
  }
  const cleaned = String(rupeesInput).replace(/[^0-9.-]/g, '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const negative = cleaned.startsWith('-');
  const absStr = negative ? cleaned.slice(1) : cleaned;
  const parts = absStr.split('.');
  const whole = parseInt(parts[0] || '0', 10);
  const fracRaw = (parts[1] || '').padEnd(3, '0').slice(0, 3);
  const fracTwo = parseInt(fracRaw.slice(0, 2), 10);
  const thirdDigit = parseInt(fracRaw[2] || '0', 10);
  const roundedFrac = thirdDigit >= 5 ? fracTwo + 1 : fracTwo;
  const total = whole * 100 + roundedFrac;
  return negative ? -total : total;
}

/**
 * Converts integer paise to rupees as a floating-point number.
 */
export function paiseToRupees(paise: Paise): number {
  assertIntegerPaise(paise);
  return paise / 100;
}

/**
 * Converts integer paise to a 2-decimal rupees string (e.g. "1234.56").
 */
export function paiseToRupeesStr(paise: Paise): string {
  assertIntegerPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/**
 * Formats integer paise with official Indian digit grouping (e.g. ₹12,34,567.00).
 * Last 3 digits are grouped, followed by groups of 2.
 */
export function formatINR(paise: Paise, includeSymbol = true): string {
  assertIntegerPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const wholeStr = String(Math.floor(abs / 100));
  const fracStr = String(abs % 100).padStart(2, '0');

  // Indian digit grouping: last 3 digits, then groups of 2 (e.g. 12,34,567.00)
  let grouped = wholeStr;
  if (wholeStr.length > 3) {
    const lastThree = wholeStr.slice(-3);
    const rest = wholeStr.slice(0, -3);
    grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
  }
  const prefix = includeSymbol ? '₹' : '';
  return `${negative ? '-' : ''}${prefix}${grouped}.${fracStr}`;
}

/**
 * Calculates standard invoice rounding to nearest whole rupee.
 * 50 to 99 paise rounds up (+), 0 to 49 paise rounds down (-).
 */
export function roundInvoicePaise(exactTotalPaise: Paise): { roundedTotalPaise: Paise; roundOffPaise: Paise } {
  assertIntegerPaise(exactTotalPaise);
  const remainder = ((exactTotalPaise % 100) + 100) % 100;
  const roundOffPaise = remainder >= 50 ? (100 - remainder) : -remainder;
  return {
    roundedTotalPaise: exactTotalPaise + roundOffPaise,
    roundOffPaise,
  };
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
}

/**
 * Converts integer paise into official Indian English amount in words.
 * Handles Crores, Lakhs, Thousands, Hundreds, Tens/Ones, and Paise.
 * Example: 123456789 -> "Rupees Twelve Lakh Thirty Four Thousand Five Hundred and Sixty Seven and Eighty Nine Paise Only"
 */
export function amountInWordsINR(paise: Paise): string {
  assertIntegerPaise(paise);
  if (paise === 0) return 'Rupees Zero Only';
  const negative = paise < 0;
  const abs = Math.abs(paise);
  let rupees = Math.floor(abs / 100);
  const remPaise = abs % 100;

  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  const hundred = Math.floor(rupees / 100);
  const underHundred = rupees % 100;

  if (crore > 0) parts.push(`${twoDigitWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (underHundred > 0) {
    if (parts.length > 0) parts.push('and');
    parts.push(twoDigitWords(underHundred));
  }

  let result = '';
  if (parts.length > 0) {
    result = `Rupees ${parts.join(' ')}`;
    if (remPaise > 0) {
      result += ` and ${twoDigitWords(remPaise)} Paise`;
    }
  } else if (remPaise > 0) {
    result = `${twoDigitWords(remPaise)} Paise`;
  }

  return `${negative ? 'Minus ' : ''}${result} Only`;
}
