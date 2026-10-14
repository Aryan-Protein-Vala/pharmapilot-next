// src/lib/gst.ts — GST inclusive/exclusive calculations, state code split & official Modulo-36 validator

import { Paise, roundInvoicePaise } from './money';

export interface LineTaxInput {
  qty: number;
  ratePaise: Paise;
  discountPctBp: number; // Basis points: 1000 = 10.00%
  gstRateBp: number;     // Basis points: 1200 = 12.00%
  taxInclusive: boolean; // Retail MRP sales can be inclusive or PTR purchase exclusive
  shopStateCode: string;
  partyStateCode: string;
}

export interface LineTaxResult {
  grossPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
  lineTotalPaise: Paise;
  isInterState: boolean;
}

export interface InvoiceTaxSummary {
  subtotalPaise: Paise;
  discountPaise: Paise;
  billDiscountPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
}

/**
 * Computes GST line values for retail (taxInclusive = true) or wholesale/purchase (taxInclusive = false).
 * Dispatches between Intra-State (CGST + SGST split 50/50) and Inter-State (IGST 100%).
 */
export function computeLineTax(input: LineTaxInput): LineTaxResult {
  const grossPaise = Math.round(input.qty * input.ratePaise);
  const discountPaise = Math.round((grossPaise * input.discountPctBp) / 10000);
  const afterDiscountPaise = grossPaise - discountPaise;
  const isInterState = Boolean(
    input.shopStateCode &&
    input.partyStateCode &&
    input.shopStateCode.trim() !== input.partyStateCode.trim()
  );

  let taxablePaise: Paise;
  let taxPaise: Paise;
  let lineTotalPaise: Paise;

  if (input.taxInclusive) {
    lineTotalPaise = afterDiscountPaise;
    taxablePaise = Math.round((lineTotalPaise * 10000) / (10000 + input.gstRateBp));
    taxPaise = lineTotalPaise - taxablePaise;
  } else {
    taxablePaise = afterDiscountPaise;
    taxPaise = Math.round((taxablePaise * input.gstRateBp) / 10000);
    lineTotalPaise = taxablePaise + taxPaise;
  }

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;

  if (isInterState) {
    igstPaise = taxPaise;
  } else {
    cgstPaise = Math.floor(taxPaise / 2);
    sgstPaise = taxPaise - cgstPaise;
  }

  return {
    grossPaise,
    discountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise,
    lineTotalPaise,
    isInterState,
  };
}

/**
 * Summarizes invoice lines and applies optional bill-level discount with invoice round-off.
 */
export function summarizeInvoiceTax(
  lines: LineTaxResult[],
  billDiscountPaise: Paise = 0
): InvoiceTaxSummary {
  let subtotalPaise = 0;
  let lineDiscountPaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  let exactTotalPaise = 0;

  for (const l of lines) {
    subtotalPaise += l.taxablePaise;
    lineDiscountPaise += l.discountPaise;
    cgstPaise += l.cgstPaise;
    sgstPaise += l.sgstPaise;
    igstPaise += l.igstPaise;
    exactTotalPaise += l.lineTotalPaise;
  }

  const finalExactTotal = Math.max(0, exactTotalPaise - billDiscountPaise);
  const { roundedTotalPaise, roundOffPaise } = roundInvoicePaise(finalExactTotal);

  return {
    subtotalPaise,
    discountPaise: lineDiscountPaise + billDiscountPaise,
    billDiscountPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise: cgstPaise + sgstPaise + igstPaise,
    roundOffPaise,
    totalPaise: roundedTotalPaise,
  };
}

export interface GSTINValidationResult {
  valid: boolean;
  stateCode?: string;
  expected?: string;
  reason?: string;
}

/**
 * Official Indian GSTIN Modulo-36 Checksum Validator.
 * Format: 15 alphanumeric characters: 2 state + 10 PAN + 1 entity num + 'Z' + 1 checksum char.
 */
export function validateGSTIN(gstin: string): GSTINValidationResult {
  const clean = (gstin || '').trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(clean)) {
    return { valid: false, reason: 'GSTIN must be 15 characters in format 09ABCDE1234F1Z5' };
  }
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = chars.indexOf(clean[i]);
    const factor = (i % 2 === 0) ? 1 : 2;
    const prod = code * factor;
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  const checkIndex = (36 - (sum % 36)) % 36;
  const expectedCheckChar = chars[checkIndex];
  const isValid = clean[14] === expectedCheckChar;

  return {
    valid: isValid,
    stateCode: clean.slice(0, 2),
    expected: expectedCheckChar,
    reason: isValid ? undefined : `Checksum mismatch (expected '${expectedCheckChar}' as 15th char)`,
  };
}
