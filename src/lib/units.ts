// src/lib/units.ts — Smart Pharmacy Pack & Loose Unit Conversion (Box -> Strip -> Tablet)

export interface ItemUnitDef {
  unitName: string;       // e.g. 'STRIP', 'TAB', 'BOX'
  qtyInBaseUnit: number;  // e.g. STRIP = 10 TAB, BOX = 100 TAB
  isDefaultSale?: boolean;
  isDefaultPurchase?: boolean;
}

/**
 * Converts a quantity in pack units to total base units (e.g. 5 strips of 10 = 50 tabs).
 */
export function toBaseUnits(qty: number, qtyInBaseUnit: number): number {
  if (!Number.isInteger(qty) || !Number.isInteger(qtyInBaseUnit) || qtyInBaseUnit < 1) {
    throw new Error(`Invalid unit conversion: qty=${qty}, qtyInBaseUnit=${qtyInBaseUnit}`);
  }
  return qty * qtyInBaseUnit;
}

/**
 * Decomposes a total base quantity into packs and remaining loose units.
 */
export function toPackUnits(
  baseQty: number,
  qtyInBaseUnit: number
): { packs: number; loose: number } {
  if (qtyInBaseUnit <= 1) {
    return { packs: 0, loose: baseQty };
  }
  const packs = Math.floor(baseQty / qtyInBaseUnit);
  const loose = baseQty % qtyInBaseUnit;
  return { packs, loose };
}

/**
 * Converts a transaction quantity to base units depending on unit mode ('pack' or 'loose').
 */
export function convertUnitQty(
  qty: number,
  unitMode: 'pack' | 'loose',
  qtyInBaseUnit: number
): number {
  if (unitMode === 'pack') {
    return toBaseUnits(qty, Math.max(1, qtyInBaseUnit));
  }
  return qty;
}

/**
 * Formats a base quantity into human-friendly smart stock string.
 * Example: 25 TAB with 10 TAB/STRIP -> "2 STRIP + 5 TAB".
 * Example: 20 TAB with 10 TAB/STRIP -> "2 STRIP".
 * Example: 5 TAB with 10 TAB/STRIP -> "5 TAB".
 */
export function formatSmartStock(
  totalBaseQty: number,
  baseUnitName: string,
  saleUnit?: ItemUnitDef
): string {
  const sign = totalBaseQty < 0 ? '-' : '';
  const abs = Math.abs(totalBaseQty);
  if (!saleUnit || saleUnit.qtyInBaseUnit <= 1) {
    return `${sign}${abs} ${baseUnitName}`;
  }
  const packs = Math.floor(abs / saleUnit.qtyInBaseUnit);
  const loose = abs % saleUnit.qtyInBaseUnit;
  if (packs > 0 && loose > 0) {
    return `${sign}${packs} ${saleUnit.unitName} + ${loose} ${baseUnitName}`;
  }
  if (packs > 0) {
    return `${sign}${packs} ${saleUnit.unitName}`;
  }
  return `${sign}${loose} ${baseUnitName}`;
}

/**
 * Parses Marg packaging strings like "10x10", "1x15", "15 TAB", "100ML", "200 GM".
 */
export function parsePackString(
  packRaw: string
): { baseUnit: string; saleUnitName: string; qtyInBaseUnit: number } {
  const s = (packRaw || '').trim().toUpperCase();
  const stripMatch = s.match(/(\d+)\s*[X\*]\s*(\d+)/);
  if (stripMatch) {
    const perStrip = parseInt(stripMatch[2], 10) || 10;
    return { baseUnit: 'TAB', saleUnitName: 'STRIP', qtyInBaseUnit: perStrip };
  }
  const singleStrip = s.match(/^(\d+)\s*(TAB|CAP|TABS|CAPS|S?)$/);
  if (singleStrip) {
    const perStrip = parseInt(singleStrip[1], 10) || 10;
    return { baseUnit: 'TAB', saleUnitName: 'STRIP', qtyInBaseUnit: perStrip };
  }
  if (s.includes('ML') || s.includes('SYP') || s.includes('LIQ')) {
    return { baseUnit: 'BOTTLE', saleUnitName: 'BOTTLE', qtyInBaseUnit: 1 };
  }
  if (s.includes('GM') || s.includes('KG') || s.includes('OINT') || s.includes('CREAM') || s.includes('GEL')) {
    return { baseUnit: 'TUBE', saleUnitName: 'TUBE', qtyInBaseUnit: 1 };
  }
  return { baseUnit: 'UNIT', saleUnitName: 'PACK', qtyInBaseUnit: 1 };
}
