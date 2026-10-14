// src/lib/dates.ts — Indian Financial Year (April–March), DD-MM-YYYY formatting & Expiry Parser

/**
 * Returns Indian Financial Year string (e.g. "2026-27" for date in October 2026).
 */
export function getIndianFY(dateStrOrObj: string | Date = new Date(), fyStartMonth = 4): string {
  const d = typeof dateStrOrObj === 'string' ? new Date(dateStrOrObj) : dateStrOrObj;
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1..12
  const startYear = month >= fyStartMonth ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYearShort}`;
}

/**
 * Formats ISO date (YYYY-MM-DD) into Indian standard DD-MM-YYYY.
 */
export function formatDateIN(isoDate: string): string {
  if (!isoDate) return '';
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Computes the last calendar day of a given year and month (1-12) as YYYY-MM-DD.
 */
export function lastDayOfMonth(year: number, month1To12: number): string {
  const lastDay = new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
  return `${year}-${String(month1To12).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Flexible pharmaceutical expiry date parser.
 * Accepts: "0627", "06/27", "06/2027", "2027-06-30", "30-06-2027", "Jun-27", "Jun 2027".
 * Returns ISO expiry date snapped to the last day of that month.
 */
export function parseExpiryInput(raw: string): {
  valid: boolean;
  isoExpiryDate?: string;
  displayMonthYear?: string;
  error?: string;
} {
  const s = (raw || '').trim();
  if (!s) return { valid: false, error: 'Expiry is required' };

  const monthsMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };

  let month = 0;
  let year = 0;

  if (/^\d{4}$/.test(s)) {
    month = parseInt(s.slice(0, 2), 10);
    year = 2000 + parseInt(s.slice(2, 4), 10);
  } else if (/^(\d{1,2})[\/\-](\d{2}|\d{4})$/.test(s)) {
    const match = s.match(/^(\d{1,2})[\/\-](\d{2}|\d{4})$/)!;
    month = parseInt(match[1], 10);
    year = match[2].length === 2 ? 2000 + parseInt(match[2], 10) : parseInt(match[2], 10);
  } else if (/^(\d{4})-(\d{2})-(\d{2})$/.test(s)) {
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
    year = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
  } else if (/^(\d{2})-(\d{2})-(\d{4})$/.test(s)) {
    const match = s.match(/^(\d{2})-(\d{2})-(\d{4})$/)!;
    year = parseInt(match[3], 10);
    month = parseInt(match[2], 10);
  } else if (/^([A-Za-z]{3})[\s\-\/](\d{2}|\d{4})$/.test(s)) {
    const match = s.match(/^([A-Za-z]{3})[\s\-\/](\d{2}|\d{4})$/)!;
    month = monthsMap[match[1].toLowerCase()] || 0;
    year = match[2].length === 2 ? 2000 + parseInt(match[2], 10) : parseInt(match[2], 10);
  } else {
    return { valid: false, error: `Unrecognized expiry format "${s}". Use MM/YY (e.g. 06/27 or 0627).` };
  }

  if (month < 1 || month > 12 || year < 2000 || year > 2100) {
    return { valid: false, error: `Invalid expiry month/year (${month}/${year})` };
  }

  const isoExpiryDate = lastDayOfMonth(year, month);
  const displayMonthYear = `${String(month).padStart(2, '0')}/${String(year).slice(-2)}`;
  return { valid: true, isoExpiryDate, displayMonthYear };
}

/**
 * Checks whether a batch with given ISO expiry date is expired relative to asOfIsoDate.
 */
export function isBatchExpired(isoExpiryDate: string, asOfIsoDate: string): boolean {
  const refDate = asOfIsoDate.slice(0, 10);
  return isoExpiryDate.slice(0, 10) < refDate;
}

/**
 * Calculates number of days remaining until expiry relative to asOfIsoDate.
 * Negative number indicates past expiry.
 */
export function daysUntilExpiry(isoExpiryDate: string, asOfIsoDate: string): number {
  const expMs = new Date(isoExpiryDate.slice(0, 10) + 'T00:00:00Z').getTime();
  const refMs = new Date(asOfIsoDate.slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.floor((expMs - refMs) / (1000 * 60 * 60 * 24));
}
