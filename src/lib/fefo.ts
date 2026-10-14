// src/lib/fefo.ts — First-Expiry-First-Out Batch Allocation & Multi-Batch Split

import { isBatchExpired } from './dates';
import { Paise } from './money';

export interface CandidateBatch {
  batchId: string;
  batchNo: string;
  expiryDate: string; // YYYY-MM-DD
  availableQtyBase: number;
  mrpPaise: Paise;
  ptrPaise: Paise;
}

export interface AllocatedBatchSlice {
  batchId: string;
  batchNo: string;
  expiryDate: string;
  allocatedQtyBase: number;
  mrpPaise: Paise;
  ptrPaise: Paise;
}

export interface FefoAllocationResult {
  ok: boolean;
  allocations: AllocatedBatchSlice[];
  shortfallQtyBase: number;
  blockedExpiredBatchNos: string[];
  error?: string;
}

/**
 * Allocates requested quantity across batches using FEFO (First-Expiry-First-Out).
 * Supports automatic multi-batch splitting, expired batch hard blocking, and shortfall reporting.
 *
 * @param batches Available batches with stock
 * @param requestedQtyBase Requested quantity in base units (e.g. tablets)
 * @param asOfIsoDate Current ISO date (YYYY-MM-DD) to evaluate expiration against
 * @param allowExpiredOverride If true, allows allocating expired stock (e.g. for return-to-supplier/damage writeoff)
 */
export function allocateFEFO(
  batches: CandidateBatch[],
  requestedQtyBase: number,
  asOfIsoDate: string,
  allowExpiredOverride = false
): FefoAllocationResult {
  if (requestedQtyBase <= 0 || !Number.isInteger(requestedQtyBase)) {
    return {
      ok: false,
      allocations: [],
      shortfallQtyBase: requestedQtyBase,
      blockedExpiredBatchNos: [],
      error: 'Requested quantity must be a positive integer in base units',
    };
  }

  const blockedExpiredBatchNos: string[] = [];
  const eligible: CandidateBatch[] = [];

  for (const b of batches) {
    if (b.availableQtyBase <= 0) continue;
    const expired = isBatchExpired(b.expiryDate, asOfIsoDate);
    if (expired && !allowExpiredOverride) {
      blockedExpiredBatchNos.push(b.batchNo);
      continue;
    }
    eligible.push(b);
  }

  // Sort strictly by earliest expiry_date first (FEFO), tie-breaking by batchNo
  eligible.sort((a, b) => {
    const cmp = a.expiryDate.localeCompare(b.expiryDate);
    return cmp !== 0 ? cmp : a.batchNo.localeCompare(b.batchNo);
  });

  const allocations: AllocatedBatchSlice[] = [];
  let remaining = requestedQtyBase;

  for (const b of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(b.availableQtyBase, remaining);
    allocations.push({
      batchId: b.batchId,
      batchNo: b.batchNo,
      expiryDate: b.expiryDate,
      allocatedQtyBase: take,
      mrpPaise: b.mrpPaise,
      ptrPaise: b.ptrPaise,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    const expNote =
      blockedExpiredBatchNos.length > 0
        ? ` (Expired batches blocked: ${blockedExpiredBatchNos.join(', ')})`
        : '';
    return {
      ok: false,
      allocations,
      shortfallQtyBase: remaining,
      blockedExpiredBatchNos,
      error: `Insufficient unexpired stock: short by ${remaining} base units${expNote}`,
    };
  }

  return {
    ok: true,
    allocations,
    shortfallQtyBase: 0,
    blockedExpiredBatchNos,
  };
}
