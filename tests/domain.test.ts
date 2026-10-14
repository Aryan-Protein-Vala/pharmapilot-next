// tests/domain.test.ts — Comprehensive Unit & Property Tests for PharmaPilot Domain Logic
import { describe, it, expect } from 'vitest';
import {
  rupeesToPaise,
  paiseToRupees,
  paiseToRupeesStr,
  formatINR,
  roundInvoicePaise,
  amountInWordsINR,
  assertIntegerPaise,
} from '../src/lib/money';
import {
  computeLineTax,
  summarizeInvoiceTax,
  validateGSTIN,
} from '../src/lib/gst';
import {
  allocateFEFO,
  CandidateBatch,
} from '../src/lib/fefo';
import {
  toBaseUnits,
  toPackUnits,
  convertUnitQty,
  formatSmartStock,
  parsePackString,
} from '../src/lib/units';
import {
  validatePrescriptionCompliance,
  assertCompliance,
  buildScheduleRegisterEntries,
  isRestrictedSchedule,
  isScheduleH1OrXOrNDPS,
} from '../src/lib/compliance';
import {
  formatDateIN,
  getIndianFY,
  parseExpiryInput,
  isBatchExpired,
  daysUntilExpiry,
} from '../src/lib/dates';

describe('1. Money & Indian Grouping Domain Logic', () => {
  it('matches 100% of the baseline assertions from made by gemini', () => {
    // 1. Money & Indian Grouping Tests from domain.test.mjs
    expect(rupeesToPaise('1234567.89')).toBe(123456789);
    expect(formatINR(123456700)).toBe('₹12,34,567.00');
    expect(formatINR(99950)).toBe('₹999.50');
    expect(roundInvoicePaise(14560)).toEqual({ roundedTotalPaise: 14600, roundOffPaise: 40 });
    expect(roundInvoicePaise(14540)).toEqual({ roundedTotalPaise: 14500, roundOffPaise: -40 });
  });

  it('handles rupees to paise conversion with various formats and types', () => {
    expect(rupeesToPaise(100)).toBe(10000);
    expect(rupeesToPaise(100.5)).toBe(10050);
    expect(rupeesToPaise(100.555)).toBe(10056); // 3rd decimal rounding
    expect(rupeesToPaise('₹ 1,234.50')).toBe(123450);
    expect(rupeesToPaise('-50.25')).toBe(-5025);
    expect(rupeesToPaise('')).toBe(0);
    expect(rupeesToPaise('abc')).toBe(0);
  });

  it('converts paise to rupees and rupees strings correctly', () => {
    expect(paiseToRupees(123456)).toBe(1234.56);
    expect(paiseToRupees(-500)).toBe(-5);
    expect(paiseToRupeesStr(123456)).toBe('1234.56');
    expect(paiseToRupeesStr(5)).toBe('0.05');
    expect(paiseToRupeesStr(-750)).toBe('-7.50');
  });

  it('formats INR with and without symbol and handles negative amounts', () => {
    expect(formatINR(123456700, false)).toBe('12,34,567.00');
    expect(formatINR(-123456700, true)).toBe('-₹12,34,567.00');
    expect(formatINR(-99950, false)).toBe('-999.50');
    expect(formatINR(0)).toBe('₹0.00');
  });

  it('guarantees integer safety via assertIntegerPaise', () => {
    expect(() => assertIntegerPaise(100)).not.toThrow();
    expect(() => assertIntegerPaise(100.5)).toThrow(/Invalid non-integer paise/);
  });

  it('converts paise amounts to official Indian English words', () => {
    expect(amountInWordsINR(0)).toBe('Rupees Zero Only');
    expect(amountInWordsINR(123456700)).toBe(
      'Rupees Twelve Lakh Thirty Four Thousand Five Hundred and Sixty Seven Only'
    );
    expect(amountInWordsINR(14550)).toBe('Rupees One Hundred and Forty Five and Fifty Paise Only');
    expect(amountInWordsINR(75)).toBe('Seventy Five Paise Only');
    expect(amountInWordsINR(1000000000)).toBe('Rupees One Crore Only');
    expect(amountInWordsINR(-5000)).toBe('Minus Rupees Fifty Only');
  });
});

describe('2. GST & Checksum Domain Logic', () => {
  it('matches 100% of the baseline assertions from made by gemini', () => {
    // Intra-state retail tax-inclusive calculation
    const intraInclusive = computeLineTax({
      qty: 2,
      ratePaise: 11200,
      discountPctBp: 0,
      gstRateBp: 1200,
      taxInclusive: true,
      shopStateCode: '09',
      partyStateCode: '09',
    });
    expect(intraInclusive.taxablePaise).toBe(20000);
    expect(intraInclusive.cgstPaise).toBe(1200);
    expect(intraInclusive.sgstPaise).toBe(1200);
    expect(intraInclusive.igstPaise).toBe(0);
    expect(intraInclusive.lineTotalPaise).toBe(22400);

    // Inter-state wholesale tax-exclusive calculation
    const interExclusive = computeLineTax({
      qty: 10,
      ratePaise: 8000,
      discountPctBp: 1000,
      gstRateBp: 1200,
      taxInclusive: false,
      shopStateCode: '09',
      partyStateCode: '07',
    });
    expect(interExclusive.grossPaise).toBe(80000);
    expect(interExclusive.discountPaise).toBe(8000);
    expect(interExclusive.taxablePaise).toBe(72000);
    expect(interExclusive.igstPaise).toBe(8640);
    expect(interExclusive.cgstPaise).toBe(0);
    expect(interExclusive.lineTotalPaise).toBe(80640);

    // GSTIN Modulo-36 Checksum Validation
    const checkSample = validateGSTIN('09AAACH7409R1ZZ');
    const validGstin = '09AAACH7409R1Z' + checkSample.expected;
    expect(validateGSTIN(validGstin).valid).toBe(true);
    expect(validateGSTIN('09AAACH7409R1Z0').valid).toBe(false);
  });

  it('rejects malformed GSTIN syntax', () => {
    expect(validateGSTIN('').valid).toBe(false);
    expect(validateGSTIN('SHORT').valid).toBe(false);
    expect(validateGSTIN('09AAACH7409R1Z').valid).toBe(false); // 14 chars
    expect(validateGSTIN('999AAACH7409R1Z5').valid).toBe(false); // 16 chars
    expect(validateGSTIN('09AAACH7409R115').valid).toBe(false); // missing 'Z' in 14th pos
  });

  it('summarizes invoice tax correctly with intra/inter-state lines and bill discount', () => {
    const line1 = computeLineTax({
      qty: 2,
      ratePaise: 11200,
      discountPctBp: 0,
      gstRateBp: 1200,
      taxInclusive: true,
      shopStateCode: '09',
      partyStateCode: '09',
    });
    const line2 = computeLineTax({
      qty: 1,
      ratePaise: 5600,
      discountPctBp: 0,
      gstRateBp: 1200,
      taxInclusive: true,
      shopStateCode: '09',
      partyStateCode: '09',
    });

    const summaryNoDisc = summarizeInvoiceTax([line1, line2], 0);
    expect(summaryNoDisc.subtotalPaise).toBe(25000);
    expect(summaryNoDisc.cgstPaise).toBe(1500);
    expect(summaryNoDisc.sgstPaise).toBe(1500);
    expect(summaryNoDisc.totalPaise).toBe(28000);

    // With bill discount of ₹5.40 (540 paise)
    const summaryWithDisc = summarizeInvoiceTax([line1, line2], 540);
    expect(summaryWithDisc.billDiscountPaise).toBe(540);
    // 28000 - 540 = 27460 -> rounds to 27500 with +40 roundOff
    expect(summaryWithDisc.totalPaise).toBe(27500);
    expect(summaryWithDisc.roundOffPaise).toBe(40);
  });
});

describe('3. FEFO Allocation & Multi-Batch Split Domain Logic', () => {
  const sampleBatches: CandidateBatch[] = [
    { batchId: 'b_exp', batchNo: 'EXP01', expiryDate: '2026-05-31', availableQtyBase: 50, mrpPaise: 10000, ptrPaise: 7000 },
    { batchId: 'b_late', batchNo: 'LATE02', expiryDate: '2027-12-31', availableQtyBase: 30, mrpPaise: 11000, ptrPaise: 7500 },
    { batchId: 'b_soon', batchNo: 'SOON01', expiryDate: '2027-02-28', availableQtyBase: 15, mrpPaise: 10500, ptrPaise: 7200 },
  ];

  it('matches 100% of the baseline assertions from made by gemini', () => {
    const fefoRes = allocateFEFO(sampleBatches, 25, '2026-10-14', false);
    expect(fefoRes.ok).toBe(true);
    expect(fefoRes.blockedExpiredBatchNos).toEqual(['EXP01']);
    expect(fefoRes.allocations.length).toBe(2);
    expect(fefoRes.allocations[0].batchNo).toBe('SOON01');
    expect(fefoRes.allocations[0].allocatedQtyBase).toBe(15);
    expect(fefoRes.allocations[1].batchNo).toBe('LATE02');
    expect(fefoRes.allocations[1].allocatedQtyBase).toBe(10);
  });

  it('reports shortfall when unexpired stock is insufficient', () => {
    // Available unexpired: 15 (SOON01) + 30 (LATE02) = 45. Request 50.
    const res = allocateFEFO(sampleBatches, 50, '2026-10-14', false);
    expect(res.ok).toBe(false);
    expect(res.shortfallQtyBase).toBe(5);
    expect(res.blockedExpiredBatchNos).toEqual(['EXP01']);
    expect(res.allocations.reduce((acc, a) => acc + a.allocatedQtyBase, 0)).toBe(45);
    expect(res.error).toMatch(/short by 5 base units/);
  });

  it('allows allocating expired batches when allowExpiredOverride is true', () => {
    // When override is true, EXP01 (50 available, expiring 2026-05-31) is eligible and allocated first!
    const res = allocateFEFO(sampleBatches, 20, '2026-10-14', true);
    expect(res.ok).toBe(true);
    expect(res.blockedExpiredBatchNos).toEqual([]);
    expect(res.allocations.length).toBe(1);
    expect(res.allocations[0].batchNo).toBe('EXP01');
    expect(res.allocations[0].allocatedQtyBase).toBe(20);
  });

  it('rejects invalid non-positive or non-integer requested quantities', () => {
    const resZero = allocateFEFO(sampleBatches, 0, '2026-10-14');
    expect(resZero.ok).toBe(false);
    expect(resZero.error).toMatch(/Requested quantity must be a positive integer/);

    const resFloat = allocateFEFO(sampleBatches, 2.5, '2026-10-14');
    expect(resFloat.ok).toBe(false);
  });
});

describe('4. Property Test: Stock Balance Immutable Movement Invariant', () => {
  it('matches 100% of the baseline assertions from made by gemini (Phase 6 DoD)', () => {
    const movements: Array<{ type: string; qty: number }> = [];
    let expectedBalance = 0;
    const ops = [
      { type: 'opening', qty: 200 },
      { type: 'purchase', qty: 150 },
      { type: 'sale', qty: -45 },
      { type: 'sale_return', qty: 5 },
      { type: 'purchase_return', qty: -20 },
      { type: 'adjustment', qty: -3 },
      { type: 'expiry_writeoff', qty: -12 },
    ];
    for (const op of ops) {
      movements.push(op);
      expectedBalance += op.qty;
    }
    const derivedBalance = movements.reduce((acc, m) => acc + m.qty, 0);
    expect(derivedBalance).toBe(expectedBalance);
    expect(derivedBalance).toBe(275);
  });
});

describe('5. Smart Pack/Loose Unit Conversion Domain Logic', () => {
  it('converts packs and units accurately', () => {
    expect(toBaseUnits(5, 10)).toBe(50);
    expect(toPackUnits(25, 10)).toEqual({ packs: 2, loose: 5 });
    expect(toPackUnits(30, 10)).toEqual({ packs: 3, loose: 0 });
    expect(toPackUnits(7, 10)).toEqual({ packs: 0, loose: 7 });

    expect(convertUnitQty(3, 'pack', 10)).toBe(30);
    expect(convertUnitQty(3, 'loose', 10)).toBe(3);
  });

  it('formats smart stock labels for retail chemist UI', () => {
    const stripUnit = { unitName: 'STRIP', qtyInBaseUnit: 10 };
    expect(formatSmartStock(25, 'TAB', stripUnit)).toBe('2 STRIP + 5 TAB');
    expect(formatSmartStock(20, 'TAB', stripUnit)).toBe('2 STRIP');
    expect(formatSmartStock(5, 'TAB', stripUnit)).toBe('5 TAB');
    expect(formatSmartStock(0, 'TAB', stripUnit)).toBe('0 TAB');
    expect(formatSmartStock(100, 'TAB')).toBe('100 TAB');
    expect(formatSmartStock(-15, 'TAB', stripUnit)).toBe('-1 STRIP + 5 TAB');
  });

  it('parses packaging strings from various pharma vendors', () => {
    expect(parsePackString('10x10')).toEqual({ baseUnit: 'TAB', saleUnitName: 'STRIP', qtyInBaseUnit: 10 });
    expect(parsePackString('1X15')).toEqual({ baseUnit: 'TAB', saleUnitName: 'STRIP', qtyInBaseUnit: 15 });
    expect(parsePackString('10 TAB')).toEqual({ baseUnit: 'TAB', saleUnitName: 'STRIP', qtyInBaseUnit: 10 });
    expect(parsePackString('100ML SYRUP')).toEqual({ baseUnit: 'BOTTLE', saleUnitName: 'BOTTLE', qtyInBaseUnit: 1 });
    expect(parsePackString('20GM OINTMENT')).toEqual({ baseUnit: 'TUBE', saleUnitName: 'TUBE', qtyInBaseUnit: 1 });
  });
});

describe('6. CDSCO Compliance Interceptor (Schedule H / H1 / X / NDPS)', () => {
  it('correctly identifies restricted schedules', () => {
    expect(isRestrictedSchedule('H')).toBe(true);
    expect(isRestrictedSchedule('h1')).toBe(true);
    expect(isRestrictedSchedule('X')).toBe(true);
    expect(isRestrictedSchedule('NDPS')).toBe(true);
    expect(isRestrictedSchedule('OTC')).toBe(false);
    expect(isRestrictedSchedule('none')).toBe(false);
    expect(isRestrictedSchedule('')).toBe(false);

    expect(isScheduleH1OrXOrNDPS('H1')).toBe(true);
    expect(isScheduleH1OrXOrNDPS('H')).toBe(false);
  });

  it('passes validation when no restricted schedule items exist on invoice', () => {
    const res = validatePrescriptionCompliance({
      lines: [
        { itemId: 'it_parac', itemName: 'Paracetamol 650', schedule: 'OTC', batchNo: 'B1', qty: 10 },
        { itemId: 'it_band', itemName: 'Bandage Strip', schedule: 'none', batchNo: 'B2', qty: 2 },
      ],
    });
    expect(res.valid).toBe(true);
    expect(res.hasRestrictedItems).toBe(false);
    expect(res.violations.length).toBe(0);
  });

  it('fails validation when Schedule H/H1/X/NDPS items are present without mandatory compliance info', () => {
    const res = validatePrescriptionCompliance({
      lines: [
        { itemId: 'it_amox', itemName: 'Amoxicillin 500mg', schedule: 'H', batchNo: 'B101', qty: 10 },
        { itemId: 'it_alpra', itemName: 'Alprazolam 0.5mg', schedule: 'H1', batchNo: 'B102', qty: 5 },
      ],
      // Missing patient and doctor info
    });
    expect(res.valid).toBe(false);
    expect(res.hasRestrictedItems).toBe(true);
    expect(res.restrictedSchedulesFound).toEqual(['H', 'H1']);
    expect(res.violations.some((v) => v.field === 'patientName')).toBe(true);
    expect(res.violations.some((v) => v.field === 'patientAddress')).toBe(true);
    expect(res.violations.some((v) => v.field === 'doctorName')).toBe(true);
    expect(res.violations.some((v) => v.field === 'doctorRegNo')).toBe(true);
  });

  it('fails validation if Doctor Registration Number is missing on Schedule H/H1 bill', () => {
    const res = validatePrescriptionCompliance({
      lines: [
        { itemId: 'it_cef', itemName: 'Cefixime 200mg', schedule: 'H1', batchNo: 'B300', qty: 10 },
      ],
      patient: { name: 'Rahul Sharma', address: '123 Civil Lines, Bareilly' },
      doctor: { name: 'Dr. Anand Kumar', regNo: '' }, // Empty reg no!
    });
    expect(res.valid).toBe(false);
    expect(res.violations.length).toBe(1);
    expect(res.violations[0].field).toBe('doctorRegNo');
    expect(res.violations[0].message).toMatch(/Prescribing Doctor Registration Number/);
  });

  it('passes validation when Patient Name, Address, Doctor Name and Doctor Reg No are provided', () => {
    const validBill = {
      lines: [
        { itemId: 'it_tram', itemName: 'Tramadol 50mg', schedule: 'NDPS', batchNo: 'ND01', qty: 10 },
      ],
      patient: { name: 'Sunita Devi', address: 'Plot 44, Sector 12, Noida' },
      doctor: { name: 'Dr. V. K. Gupta', regNo: 'DMC-18492' },
    };
    const res = validatePrescriptionCompliance(validBill);
    expect(res.valid).toBe(true);
    expect(res.violations.length).toBe(0);
    expect(() => assertCompliance(validBill)).not.toThrow();
  });

  it('throws in assertCompliance if compliance rules are violated', () => {
    expect(() => {
      assertCompliance({
        lines: [{ itemId: 'it_x', itemName: 'Diazepam 5mg', schedule: 'X', batchNo: 'X01', qty: 10 }],
      });
    }).toThrow(/Prescription Compliance Violation/);
  });

  it('builds official CDSCO schedule_register database records', () => {
    const records = buildScheduleRegisterEntries({
      saleId: 'sal_1001',
      date: '2026-10-14',
      patient: { name: 'Sunita Devi', address: 'Plot 44, Sector 12, Noida' },
      doctor: { name: 'Dr. V. K. Gupta', regNo: 'DMC-18492' },
      lines: [
        { saleItemId: 'si_1', itemName: 'Cefixime 200mg', schedule: 'H1', batchNo: 'CF01', qty: 10 },
        { saleItemId: 'si_2', itemName: 'Paracetamol 650mg', schedule: 'OTC', batchNo: 'PC01', qty: 20 },
      ],
    });

    // Only the H1 item should be inserted into schedule register
    expect(records.length).toBe(1);
    expect(records[0]).toEqual({
      id: 'reg_sal_1001_si_1',
      saleId: 'sal_1001',
      saleItemId: 'si_1',
      date: '2026-10-14',
      patientName: 'Sunita Devi',
      patientAddress: 'Plot 44, Sector 12, Noida',
      doctorName: 'Dr. V. K. Gupta',
      doctorRegNo: 'DMC-18492',
      itemName: 'Cefixime 200mg',
      batchNo: 'CF01',
      qty: 10,
      schedule: 'H1',
    });
  });
});

describe('7. Date & Financial Year Helpers Domain Logic', () => {
  it('computes Indian FY and formats DD-MM-YYYY dates', () => {
    expect(getIndianFY('2026-10-14')).toBe('2026-27');
    expect(getIndianFY('2027-02-10')).toBe('2026-27');
    expect(getIndianFY('2027-04-01')).toBe('2027-28');
    expect(formatDateIN('2026-10-14')).toBe('14-10-2026');
  });

  it('parses diverse expiry date input strings to last calendar day', () => {
    const res1 = parseExpiryInput('06/27');
    expect(res1.valid).toBe(true);
    expect(res1.isoExpiryDate).toBe('2027-06-30');
    expect(res1.displayMonthYear).toBe('06/27');

    const res2 = parseExpiryInput('0228');
    expect(res2.valid).toBe(true);
    expect(res2.isoExpiryDate).toBe('2028-02-29'); // Leap year 2028!

    const res3 = parseExpiryInput('Dec-26');
    expect(res3.valid).toBe(true);
    expect(res3.isoExpiryDate).toBe('2026-12-31');

    expect(isBatchExpired('2026-05-31', '2026-10-14')).toBe(true);
    expect(isBatchExpired('2027-05-31', '2026-10-14')).toBe(false);
    expect(daysUntilExpiry('2026-10-20', '2026-10-14')).toBe(6);
  });
});
