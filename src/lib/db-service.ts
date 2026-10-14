// src/lib/db-service.ts — Domain Database Service for PharmaPilot Next
import { getDb, initDatabase } from './db';
import { seedDatabase } from './seed';
import { computeLineTax, summarizeInvoiceTax } from './gst';
import { allocateFEFO } from './fefo';
import { validatePrescriptionCompliance, isRestrictedSchedule } from './compliance';
import { isBatchExpired, daysUntilExpiry } from './dates';
import { rupeesToPaise, formatINR, paiseToRupeesStr } from './money';
import type { Client } from '@libsql/client';

let isInitialized = false;

export async function ensureDbReady(): Promise<Client> {
  const db = getDb();
  if (!isInitialized) {
    await initDatabase(db);
    // Check if shop_profile or items exist; if completely empty, run seeder
    const check = await db.execute('SELECT COUNT(*) as cnt FROM items');
    if (Number(check.rows[0]?.cnt || 0) === 0) {
      await seedDatabase(db);
    }
    isInitialized = true;
  }
  return db;
}

// ----------------------------------------------------------------------------
// 1. DASHBOARD SERVICE
// ----------------------------------------------------------------------------
export async function getDashboardMetrics() {
  const db = await ensureDbReady();
  const todayIso = new Date().toISOString().slice(0, 10);

  // Today's revenue & bills count
  const salesTodayRes = await db.execute({
    sql: `SELECT COUNT(*) as bill_count, COALESCE(SUM(total_paise), 0) as revenue_paise
          FROM sales_invoices
          WHERE invoice_date = ? AND status = 'posted'`,
    args: [todayIso],
  });
  const todayBillCount = Number(salesTodayRes.rows[0]?.bill_count || 0);
  const todayRevenuePaise = Number(salesTodayRes.rows[0]?.revenue_paise || 0);

  // Overall Total Sales
  const allSalesRes = await db.execute(`
    SELECT COUNT(*) as total_bills, COALESCE(SUM(total_paise), 0) as gross_sales_paise
    FROM sales_invoices WHERE status = 'posted'
  `);
  const grossSalesPaise = Number(allSalesRes.rows[0]?.gross_sales_paise || 0);
  const totalBillsCount = Number(allSalesRes.rows[0]?.total_bills || 0);

  // Outstanding Customer Receivables
  const partiesRes = await db.execute(`
    SELECT id, name, type, phone, opening_balance_paise, opening_balance_type
    FROM parties WHERE is_active = 1
  `);
  const ledgerRes = await db.execute(`
    SELECT party_id, SUM(debit_paise) as total_debit, SUM(credit_paise) as total_credit
    FROM ledger_entries GROUP BY party_id
  `);
  const ledgerMap = new Map<string, { debit: number; credit: number }>();
  for (const row of ledgerRes.rows) {
    ledgerMap.set(String(row.party_id), {
      debit: Number(row.total_debit || 0),
      credit: Number(row.total_credit || 0),
    });
  }

  let customerReceivablesPaise = 0;
  for (const p of partiesRes.rows) {
    if (p.type === 'customer' || p.type === 'both') {
      const led = ledgerMap.get(String(p.id)) || { debit: 0, credit: 0 };
      const opBal = p.opening_balance_type === 'cr' ? -Number(p.opening_balance_paise || 0) : Number(p.opening_balance_paise || 0);
      const net = opBal + led.debit - led.credit;
      if (net > 0) customerReceivablesPaise += net;
    }
  }

  // Stock & Expiry Watch
  const stockRows = await db.execute(`
    SELECT
      v.batch_id, v.item_id, v.batch_no, v.expiry_date, v.mrp_paise, v.current_qty_base,
      i.name as item_name, i.schedule, i.base_unit, i.reorder_level
    FROM v_batch_stock v
    JOIN items i ON i.id = v.item_id
    WHERE v.current_qty_base > 0
  `);

  let nearExpiryCount = 0;
  let expiredCount = 0;
  const criticalExpiryList: any[] = [];
  const itemStockMap = new Map<string, { name: string; current: number; reorder: number; baseUnit: string }>();

  for (const row of stockRows.rows) {
    const expDate = String(row.expiry_date);
    const daysLeft = daysUntilExpiry(expDate, todayIso);
    const qty = Number(row.current_qty_base || 0);

    if (daysLeft < 0) {
      expiredCount++;
    } else if (daysLeft <= 60) {
      nearExpiryCount++;
      criticalExpiryList.push({
        batchId: row.batch_id,
        batchNo: row.batch_no,
        medicine: row.item_name,
        expiry: expDate,
        daysLeft,
        stock: `${qty} ${row.base_unit}`,
        schedule: `Schedule ${row.schedule}`,
      });
    }

    const itmId = String(row.item_id);
    const existing = itemStockMap.get(itmId) || {
      name: String(row.item_name),
      current: 0,
      reorder: Number(row.reorder_level || 20),
      baseUnit: String(row.base_unit),
    };
    existing.current += qty;
    itemStockMap.set(itmId, existing);
  }

  let lowStockReordersCount = 0;
  const lowStockItems: any[] = [];
  const allItemsRes = await db.execute(`SELECT id, name, base_unit, reorder_level, reorder_qty FROM items WHERE is_active = 1`);
  for (const itm of allItemsRes.rows) {
    const id = String(itm.id);
    const st = itemStockMap.get(id)?.current || 0;
    const reorder = Number(itm.reorder_level || 20);
    if (st <= reorder) {
      lowStockReordersCount++;
      lowStockItems.push({
        id,
        name: itm.name,
        currentStock: st,
        reorderLevel: reorder,
        suggestedOrder: Math.max((Number(itm.reorder_qty) || 100) - st, 20),
        baseUnit: itm.base_unit,
      });
    }
  }

  // Recent sales bills
  const recentSalesRes = await db.execute(`
    SELECT
      s.id, s.invoice_no, s.invoice_date, s.patient_name, s.payment_mode,
      s.subtotal_paise, s.cgst_paise, s.sgst_paise, s.igst_paise, s.total_paise,
      d.name as doctor_name, d.reg_no as doctor_reg_no,
      (SELECT COUNT(*) FROM sales_items WHERE sale_id = s.id) as item_count
    FROM sales_invoices s
    LEFT JOIN doctors d ON d.id = s.doctor_id
    WHERE s.status = 'posted'
    ORDER BY s.invoice_date DESC, s.created_at DESC
    LIMIT 6
  `);

  // Schedule Log count
  const schedCountRes = await db.execute(`SELECT COUNT(*) as count FROM schedule_register`);
  const scheduleCount = Number(schedCountRes.rows[0]?.count || 0);

  return {
    todayRevenuePaise,
    todayBillCount,
    grossSalesPaise,
    totalBillsCount,
    customerReceivablesPaise,
    nearExpiryCount,
    expiredCount,
    lowStockReordersCount,
    scheduleCount,
    criticalExpiryList: criticalExpiryList.slice(0, 5),
    lowStockItems: lowStockItems.slice(0, 5),
    recentSales: recentSalesRes.rows,
  };
}

// ----------------------------------------------------------------------------
// 2. POS BILLING SERVICE
// ----------------------------------------------------------------------------
export async function getPosCatalog() {
  const db = await ensureDbReady();

  // Active items
  const itemsRes = await db.execute(`
    SELECT
      i.id, i.name, i.generic_name, i.category, i.drug_form, i.hsn_code,
      i.gst_rate_bp, i.schedule, i.base_unit, i.rack_location, i.barcode,
      m.name as manufacturer_name
    FROM items i
    LEFT JOIN manufacturers m ON m.id = i.manufacturer_id
    WHERE i.is_active = 1
    ORDER BY i.name ASC
  `);

  // Active units
  const unitsRes = await db.execute(`SELECT id, item_id, unit_name, qty_in_base_unit, is_default_sale FROM item_units`);
  const unitsMap = new Map<string, any[]>();
  for (const u of unitsRes.rows) {
    const list = unitsMap.get(String(u.item_id)) || [];
    list.push(u);
    unitsMap.set(String(u.item_id), list);
  }

  // Batches with live stock from v_batch_stock
  const batchesRes = await db.execute(`
    SELECT
      b.id, b.item_id, b.batch_no, b.expiry_date, b.mrp_paise, b.ptr_paise,
      v.current_qty_base
    FROM batches b
    JOIN v_batch_stock v ON v.batch_id = b.id
    ORDER BY b.expiry_date ASC
  `);
  const batchMap = new Map<string, any[]>();
  for (const b of batchesRes.rows) {
    const list = batchMap.get(String(b.item_id)) || [];
    list.push({
      id: b.id,
      itemId: b.item_id,
      batchNo: b.batch_no,
      expiryDate: b.expiry_date,
      mrpPaise: Number(b.mrp_paise),
      ptrPaise: Number(b.ptr_paise),
      availableQtyBase: Number(b.current_qty_base || 0),
    });
    batchMap.set(String(b.item_id), list);
  }

  // Customers & Doctors & Shop Profile
  const customersRes = await db.execute(`SELECT id, name, phone, address, state_code FROM parties WHERE type IN ('customer','both') AND is_active = 1 ORDER BY name ASC`);
  const doctorsRes = await db.execute(`SELECT id, name, reg_no, clinic FROM doctors WHERE is_active = 1 ORDER BY name ASC`);
  const shopRes = await db.execute(`SELECT * FROM shop_profile WHERE id = 1`);

  const catalog = itemsRes.rows.map((row) => {
    const id = String(row.id);
    const units = unitsMap.get(id) || [];
    const defaultUnit = units.find((u) => u.is_default_sale) || units[0] || { unit_name: row.base_unit, qty_in_base_unit: 1 };
    const batches = batchMap.get(id) || [];
    const totalStock = batches.reduce((sum, b) => sum + b.availableQtyBase, 0);

    return {
      id,
      name: String(row.name),
      genericName: String(row.generic_name || ''),
      manufacturer: String(row.manufacturer_name || ''),
      hsnCode: String(row.hsn_code),
      gstRateBp: Number(row.gst_rate_bp || 1200),
      schedule: String(row.schedule || 'none'),
      baseUnit: String(row.base_unit || 'TAB'),
      rackLocation: String(row.rack_location || ''),
      barcode: String(row.barcode || ''),
      saleUnit: String(defaultUnit.unit_name || 'STRIP'),
      packSize: Number(defaultUnit.qty_in_base_unit || 1),
      totalStockBase: totalStock,
      batches,
    };
  });

  return {
    catalog,
    customers: customersRes.rows,
    doctors: doctorsRes.rows,
    shop: shopRes.rows[0] || {},
  };
}

export interface CommitSalePayload {
  customerId?: string;
  doctorId?: string;
  patientName?: string;
  patientAddress?: string;
  paymentMode: 'cash' | 'upi' | 'card' | 'credit' | 'split';
  billDiscountPaise?: number;
  paidPaise?: number;
  lines: Array<{
    itemId: string;
    batchId: string;
    unitMode: 'pack' | 'loose';
    qty: number;
    discountPct: number;
  }>;
}

export async function commitSaleInvoice(payload: CommitSalePayload) {
  const db = await ensureDbReady();
  const todayIso = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  if (!payload.lines || payload.lines.length === 0) {
    throw new Error('Add at least one medicine line to the bill.');
  }

  // 1. Fetch Items, Batches, Units, and Shop Profile
  const shopRes = await db.execute(`SELECT * FROM shop_profile WHERE id = 1`);
  const shop = shopRes.rows[0] || { state_code: '29', gstin: '', name: 'PharmaPilot' };
  const shopState = String(shop.state_code || '29');

  let custState = shopState;
  if (payload.customerId) {
    const custRes = await db.execute({ sql: `SELECT state_code FROM parties WHERE id = ?`, args: [payload.customerId] });
    if (custRes.rows[0]?.state_code) custState = String(custRes.rows[0].state_code);
  }

  // 2. Validate Schedule Compliance & Batch Expiries
  const lineDetails: any[] = [];
  const complianceLines: any[] = [];

  for (const line of payload.lines) {
    const itemRes = await db.execute({ sql: `SELECT * FROM items WHERE id = ?`, args: [line.itemId] });
    const item = itemRes.rows[0];
    if (!item) throw new Error(`Medicine not found: ${line.itemId}`);

    const batchRes = await db.execute({
      sql: `SELECT b.*, v.current_qty_base
            FROM batches b
            JOIN v_batch_stock v ON v.batch_id = b.id
            WHERE b.id = ?`,
      args: [line.batchId],
    });
    const batch = batchRes.rows[0];
    if (!batch) throw new Error(`Batch not found: ${line.batchId}`);

    if (isBatchExpired(String(batch.expiry_date), todayIso)) {
      throw new Error(`Batch ${batch.batch_no} of ${item.name} is EXPIRED (${batch.expiry_date}). Hard blocked.`);
    }

    const unitsRes = await db.execute({ sql: `SELECT * FROM item_units WHERE item_id = ? AND is_default_sale = 1`, args: [item.id] });
    const packSize = Number(unitsRes.rows[0]?.qty_in_base_unit || 1);
    const saleUnitName = String(unitsRes.rows[0]?.unit_name || item.base_unit);

    const qtyBase = line.unitMode === 'pack' ? line.qty * packSize : line.qty;
    const availBase = Number(batch.current_qty_base || 0);

    if (qtyBase > availBase) {
      throw new Error(`Oversell prevented: Batch ${batch.batch_no} has only ${availBase} base units, requested ${qtyBase}.`);
    }

    const unitMrpPaise = line.unitMode === 'pack' ? Number(batch.mrp_paise) : Math.round(Number(batch.mrp_paise) / packSize);
    const discBp = Math.round((Number(line.discountPct) || 0) * 100);

    const tax = computeLineTax({
      qty: line.qty,
      ratePaise: unitMrpPaise,
      discountPctBp: discBp,
      gstRateBp: Number(item.gst_rate_bp || 1200),
      taxInclusive: true,
      shopStateCode: shopState,
      partyStateCode: custState,
    });

    lineDetails.push({
      item,
      batch,
      packSize,
      saleUnitName,
      unitMode: line.unitMode,
      qty: line.qty,
      qtyBase,
      unitMrpPaise,
      discountPctBp: discBp,
      tax,
    });

    complianceLines.push({
      itemId: String(item.id),
      itemName: String(item.name),
      schedule: String(item.schedule),
      batchNo: String(batch.batch_no),
      qty: qtyBase,
    });
  }

  // Validate CDSCO Compliance if restricted items are present
  let doctorInfo: any = null;
  if (payload.doctorId) {
    const docRes = await db.execute({ sql: `SELECT * FROM doctors WHERE id = ?`, args: [payload.doctorId] });
    doctorInfo = docRes.rows[0];
  }

  const complianceRes = validatePrescriptionCompliance({
    lines: complianceLines,
    patientName: payload.patientName,
    patientAddress: payload.patientAddress,
    doctorName: doctorInfo?.name,
    doctorRegNo: doctorInfo?.reg_no,
  });

  if (!complianceRes.valid) {
    throw new Error(`Schedule Compliance: ${complianceRes.errors.join('; ')}`);
  }

  // 3. Summarize Invoice Tax & Round Off
  const summary = summarizeInvoiceTax(
    lineDetails.map((l) => l.tax),
    payload.billDiscountPaise || 0
  );

  // 4. Generate Next Invoice Number
  const prefix = 'INV';
  const fyYear = todayIso.slice(2, 4);
  const countRes = await db.execute(`SELECT COUNT(*) as cnt FROM sales_invoices`);
  const seq = Number(countRes.rows[0]?.cnt || 0) + 1;
  const invoiceNo = `${prefix}-${fyYear}${String(seq).padStart(4, '0')}`;
  const saleId = `sal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const paidPaise = payload.paymentMode === 'credit' ? 0 : payload.paidPaise ?? summary.totalPaise;

  // 5. Execute DB Inserts
  await db.execute({
    sql: `INSERT INTO sales_invoices (
      id, invoice_no, invoice_date, customer_id, doctor_id, patient_name, patient_address,
      subtotal_paise, discount_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise,
      total_paise, payment_mode, paid_paise, status, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', '', ?)`,
    args: [
      saleId,
      invoiceNo,
      todayIso,
      payload.customerId || null,
      payload.doctorId || null,
      payload.patientName || '',
      payload.patientAddress || '',
      summary.subtotalPaise,
      summary.discountPaise,
      summary.cgstPaise,
      summary.sgstPaise,
      summary.igstPaise,
      summary.roundOffPaise,
      summary.totalPaise,
      payload.paymentMode,
      paidPaise,
      nowIso,
    ],
  });

  for (let idx = 0; idx < lineDetails.length; idx++) {
    const l = lineDetails[idx];
    const saleItemId = `si_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`;

    await db.execute({
      sql: `INSERT INTO sales_items (
        id, sale_id, item_id, batch_id, qty_base, rate_paise, mrp_paise,
        discount_pct_bp, gst_rate_bp, taxable_paise, tax_paise, line_total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        saleItemId,
        saleId,
        l.item.id,
        l.batch.id,
        l.qtyBase,
        l.unitMrpPaise,
        l.batch.mrp_paise,
        l.discountPctBp,
        l.item.gst_rate_bp,
        l.tax.taxablePaise,
        l.tax.taxPaise,
        l.tax.lineTotalPaise,
      ],
    });

    // Stock Movement (Outward Sale)
    await db.execute({
      sql: `INSERT INTO stock_movements (
        id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at
      ) VALUES (?, ?, ?, ?, 'sale', 'SALE', ?, ?)`,
      args: [`sm_${Date.now()}_${idx}`, l.item.id, l.batch.id, -l.qtyBase, saleId, nowIso],
    });

    // Schedule Register Record
    if (isRestrictedSchedule(l.item.schedule)) {
      await db.execute({
        sql: `INSERT INTO schedule_register (
          id, sale_id, sale_item_id, date, patient_name, patient_address,
          doctor_name, doctor_reg_no, item_name, batch_no, qty, schedule
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          `sr_${Date.now()}_${idx}`,
          saleId,
          saleItemId,
          todayIso,
          payload.patientName || '',
          payload.patientAddress || '',
          doctorInfo?.name || '',
          doctorInfo?.reg_no || '',
          l.item.name,
          l.batch.batch_no,
          l.qtyBase,
          l.item.schedule,
        ],
      });
    }
  }

  // Payment record
  if (paidPaise > 0) {
    await db.execute({
      sql: `INSERT INTO sales_payments (id, sale_id, mode, amount_paise, reference) VALUES (?, ?, ?, ?, ?)`,
      args: [`sp_${Date.now()}`, saleId, payload.paymentMode, paidPaise, invoiceNo],
    });
  }

  // Ledger entry for credit bill
  if (payload.paymentMode === 'credit' && payload.customerId) {
    await db.execute({
      sql: `INSERT INTO ledger_entries (
        id, party_id, date, doc_type, doc_id, debit_paise, credit_paise, narration
      ) VALUES (?, ?, ?, 'SALE_INVOICE', ?, ?, 0, ?)`,
      args: [`le_${Date.now()}`, payload.customerId, todayIso, invoiceNo, summary.totalPaise, `Credit Bill #${invoiceNo}`],
    });
  }

  return {
    saleId,
    invoiceNo,
    totalPaise: summary.totalPaise,
    roundOffPaise: summary.roundOffPaise,
    cgstPaise: summary.cgstPaise,
    sgstPaise: summary.sgstPaise,
    subtotalPaise: summary.subtotalPaise,
  };
}

// ----------------------------------------------------------------------------
// 3. INVENTORY SERVICE
// ----------------------------------------------------------------------------
export async function getInventoryStock() {
  const db = await ensureDbReady();
  const todayIso = new Date().toISOString().slice(0, 10);

  const itemsRes = await db.execute(`
    SELECT
      i.id, i.name, i.generic_name, i.base_unit, i.rack_location, i.schedule,
      i.reorder_level, i.reorder_qty, m.name as manufacturer_name
    FROM items i
    LEFT JOIN manufacturers m ON m.id = i.manufacturer_id
    WHERE i.is_active = 1
    ORDER BY i.name ASC
  `);

  const unitsRes = await db.execute(`SELECT item_id, unit_name, qty_in_base_unit FROM item_units WHERE is_default_sale = 1`);
  const unitMap = new Map<string, { unitName: string; packSize: number }>();
  for (const u of unitsRes.rows) {
    unitMap.set(String(u.item_id), { unitName: String(u.unit_name), packSize: Number(u.qty_in_base_unit || 1) });
  }

  const batchesRes = await db.execute(`
    SELECT
      b.id, b.item_id, b.batch_no, b.expiry_date, b.mrp_paise, b.ptr_paise,
      v.current_qty_base
    FROM batches b
    JOIN v_batch_stock v ON v.batch_id = b.id
    ORDER BY b.expiry_date ASC
  `);

  const itemBatchesMap = new Map<string, any[]>();
  for (const b of batchesRes.rows) {
    const list = itemBatchesMap.get(String(b.item_id)) || [];
    list.push({
      batchId: b.id,
      batchNo: b.batch_no,
      expiryDate: b.expiry_date,
      daysLeft: daysUntilExpiry(String(b.expiry_date), todayIso),
      mrpPaise: Number(b.mrp_paise),
      ptrPaise: Number(b.ptr_paise),
      stockBase: Number(b.current_qty_base || 0),
    });
    itemBatchesMap.set(String(b.item_id), list);
  }

  let grandCostPaise = 0;
  let grandMrpPaise = 0;

  const stockGrid = itemsRes.rows.map((row) => {
    const id = String(row.id);
    const u = unitMap.get(id) || { unitName: String(row.base_unit), packSize: 1 };
    const batches = itemBatchesMap.get(id) || [];
    let itemStockBase = 0;
    let itemCostPaise = 0;
    let itemMrpPaise = 0;
    let nearestExp = '—';

    const activeBatches = batches.filter((b) => b.stockBase > 0);
    for (const b of activeBatches) {
      itemStockBase += b.stockBase;
      itemCostPaise += Math.round((b.ptrPaise / u.packSize) * b.stockBase);
      itemMrpPaise += Math.round((b.mrpPaise / u.packSize) * b.stockBase);
    }
    if (activeBatches.length > 0) {
      nearestExp = activeBatches[0].expiryDate;
    }

    grandCostPaise += itemCostPaise;
    grandMrpPaise += itemMrpPaise;

    return {
      id,
      name: String(row.name),
      genericName: String(row.generic_name || ''),
      manufacturer: String(row.manufacturer_name || 'General'),
      rackLocation: String(row.rack_location || '—'),
      schedule: String(row.schedule),
      baseUnit: String(row.base_unit),
      saleUnit: u.unitName,
      packSize: u.packSize,
      nearestExpiry: nearestExp,
      currentStockBase: itemStockBase,
      costValuationPaise: itemCostPaise,
      mrpValuationPaise: itemMrpPaise,
      batches,
    };
  });

  // Recent Stock Movements Ledger
  const movesRes = await db.execute(`
    SELECT
      sm.id, sm.created_at, sm.qty_base_signed, sm.movement_type, sm.ref_doc_id,
      i.name as item_name, b.batch_no, i.base_unit
    FROM stock_movements sm
    JOIN items i ON i.id = sm.item_id
    JOIN batches b ON b.id = sm.batch_id
    ORDER BY sm.created_at DESC
    LIMIT 30
  `);

  return {
    stockGrid,
    grandCostPaise,
    grandMrpPaise,
    recentMovements: movesRes.rows,
  };
}

export async function createStockAdjustment(params: {
  batchId: string;
  qtySigned: number;
  movementType: 'adjustment' | 'damage' | 'expiry_writeoff' | 'opening';
  reason: string;
}) {
  const db = await ensureDbReady();
  const batchRes = await db.execute({ sql: `SELECT item_id, batch_no FROM batches WHERE id = ?`, args: [params.batchId] });
  const batch = batchRes.rows[0];
  if (!batch) throw new Error('Selected batch not found.');

  const nowIso = new Date().toISOString();
  const smId = `sm_adj_${Date.now()}`;

  await db.execute({
    sql: `INSERT INTO stock_movements (
      id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at
    ) VALUES (?, ?, ?, ?, ?, 'STOCK_ADJUSTMENT', ?, ?)`,
    args: [smId, batch.item_id, params.batchId, params.qtySigned, params.movementType, params.reason || 'Manual Adjustment', nowIso],
  });

  return { success: true, id: smId };
}

// ----------------------------------------------------------------------------
// 4. PURCHASES SERVICE
// ----------------------------------------------------------------------------
export async function getPurchasesCatalog() {
  const db = await ensureDbReady();
  const suppliersRes = await db.execute(`SELECT id, name, gstin, state_code, phone FROM parties WHERE type IN ('supplier','both') AND is_active = 1 ORDER BY name ASC`);
  const itemsRes = await db.execute(`SELECT id, name, generic_name, base_unit, gst_rate_bp FROM items WHERE is_active = 1 ORDER BY name ASC`);
  const unitsRes = await db.execute(`SELECT item_id, unit_name, qty_in_base_unit FROM item_units WHERE is_default_sale = 1`);
  const unitMap = new Map<string, { unitName: string; packSize: number }>();
  for (const u of unitsRes.rows) {
    unitMap.set(String(u.item_id), { unitName: String(u.unit_name), packSize: Number(u.qty_in_base_unit || 1) });
  }

  const itemsWithUnits = itemsRes.rows.map((i) => {
    const id = String(i.id);
    const u = unitMap.get(id) || { unitName: String(i.base_unit), packSize: 1 };
    return {
      id,
      name: String(i.name),
      genericName: String(i.generic_name || ''),
      baseUnit: String(i.base_unit),
      saleUnit: u.unitName,
      packSize: u.packSize,
      gstRateBp: Number(i.gst_rate_bp || 1200),
    };
  });

  const recentPurchasesRes = await db.execute(`
    SELECT
      p.id, p.supplier_invoice_no, p.invoice_date, p.entry_no, p.subtotal_paise,
      p.cgst_paise, p.sgst_paise, p.igst_paise, p.total_paise, p.payment_mode,
      s.name as supplier_name,
      (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) as item_count
    FROM purchase_invoices p
    JOIN parties s ON s.id = p.supplier_id
    WHERE p.status = 'posted'
    ORDER BY p.invoice_date DESC, p.created_at DESC
    LIMIT 15
  `);

  return {
    suppliers: suppliersRes.rows,
    items: itemsWithUnits,
    recentPurchases: recentPurchasesRes.rows,
  };
}

export interface CommitPurchasePayload {
  supplierId: string;
  supplierInvoiceNo: string;
  invoiceDate: string;
  paymentMode: 'credit' | 'cash' | 'upi';
  lines: Array<{
    itemId: string;
    batchNo: string;
    expiryDate: string; // YYYY-MM-DD
    qtyPacks: number;
    freePacks: number;
    ptrRupees: number;
    mrpRupees: number;
    discountPct: number;
    gstRateBp: number;
  }>;
}

export async function commitPurchaseInvoice(payload: CommitPurchasePayload) {
  const db = await ensureDbReady();
  const nowIso = new Date().toISOString();

  if (!payload.supplierId) throw new Error('Supplier is required.');
  if (!payload.supplierInvoiceNo.trim()) throw new Error('Supplier Invoice Number is required.');
  if (!payload.lines || payload.lines.length === 0) throw new Error('Add at least one item line.');

  // Verify non-duplicate invoice no
  const dupCheck = await db.execute({
    sql: `SELECT id FROM purchase_invoices WHERE supplier_id = ? AND supplier_invoice_no = ? AND status = 'posted'`,
    args: [payload.supplierId, payload.supplierInvoiceNo.trim()],
  });
  if (dupCheck.rows.length > 0) {
    throw new Error(`Duplicate invoice "${payload.supplierInvoiceNo}" for this supplier.`);
  }

  const shopRes = await db.execute(`SELECT state_code FROM shop_profile WHERE id = 1`);
  const shopState = String(shopRes.rows[0]?.state_code || '29');

  const supRes = await db.execute({ sql: `SELECT state_code, name FROM parties WHERE id = ?`, args: [payload.supplierId] });
  const supState = String(supRes.rows[0]?.state_code || shopState);
  const supplierName = String(supRes.rows[0]?.name || 'Supplier');

  const purId = `pur_${Date.now()}`;
  const entryCountRes = await db.execute(`SELECT COUNT(*) as cnt FROM purchase_invoices`);
  const entryNo = `PUR-${new Date().getFullYear()}-${String(Number(entryCountRes.rows[0]?.cnt || 0) + 1).padStart(4, '0')}`;

  const lineTaxes: any[] = [];
  const processedLines: any[] = [];

  for (const line of payload.lines) {
    const ptrPaise = rupeesToPaise(line.ptrRupees);
    const mrpPaise = rupeesToPaise(line.mrpRupees);
    if (mrpPaise <= 0) throw new Error(`MRP must be greater than 0.`);

    // Find or create batch
    const cleanBatchNo = line.batchNo.trim().toUpperCase();
    let batchRes = await db.execute({
      sql: `SELECT id, ptr_paise FROM batches WHERE item_id = ? AND batch_no = ? AND mrp_paise = ?`,
      args: [line.itemId, cleanBatchNo, mrpPaise],
    });

    let batchId = batchRes.rows[0]?.id ? String(batchRes.rows[0].id) : '';
    if (!batchId) {
      batchId = `bat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.execute({
        sql: `INSERT INTO batches (
          id, item_id, batch_no, expiry_date, mrp_paise, ptr_paise, pts_paise, purchase_rate_paise, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [batchId, line.itemId, cleanBatchNo, line.expiryDate, mrpPaise, ptrPaise, ptrPaise, ptrPaise, nowIso],
      });
    }

    const unitRes = await db.execute({ sql: `SELECT qty_in_base_unit FROM item_units WHERE item_id = ? AND is_default_sale = 1`, args: [line.itemId] });
    const packSize = Number(unitRes.rows[0]?.qty_in_base_unit || 1);

    // Compute line GST on BILLED units only
    const tax = computeLineTax({
      qty: line.qtyPacks,
      ratePaise: ptrPaise,
      discountPctBp: Math.round((line.discountPct || 0) * 100),
      gstRateBp: line.gstRateBp,
      taxInclusive: false,
      shopStateCode: shopState,
      partyStateCode: supState,
    });
    lineTaxes.push(tax);

    const billedBase = line.qtyPacks * packSize;
    const freeBase = (line.freePacks || 0) * packSize;

    processedLines.push({
      itemId: line.itemId,
      batchId,
      billedBase,
      freeBase,
      totalBase: billedBase + freeBase,
      ptrPaise,
      mrpPaise,
      discountPctBp: Math.round((line.discountPct || 0) * 100),
      gstRateBp: line.gstRateBp,
      tax,
    });
  }

  const summary = summarizeInvoiceTax(lineTaxes);
  const paidPaise = payload.paymentMode === 'credit' ? 0 : summary.totalPaise;

  await db.execute({
    sql: `INSERT INTO purchase_invoices (
      id, supplier_id, supplier_invoice_no, invoice_date, entry_no, subtotal_paise,
      discount_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise,
      payment_mode, paid_paise, status, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', '', ?)`,
    args: [
      purId,
      payload.supplierId,
      payload.supplierInvoiceNo.trim(),
      payload.invoiceDate,
      entryNo,
      summary.subtotalPaise,
      summary.discountPaise,
      summary.cgstPaise,
      summary.sgstPaise,
      summary.igstPaise,
      summary.roundOffPaise,
      summary.totalPaise,
      payload.paymentMode,
      paidPaise,
      nowIso,
    ],
  });

  for (let idx = 0; idx < processedLines.length; idx++) {
    const l = processedLines[idx];
    const piId = `pi_${Date.now()}_${idx}`;

    await db.execute({
      sql: `INSERT INTO purchase_items (
        id, purchase_id, item_id, batch_id, qty_billed, qty_free, rate_paise, mrp_paise,
        discount_pct_bp, gst_rate_bp, taxable_paise, tax_paise, line_total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        piId,
        purId,
        l.itemId,
        l.batchId,
        l.billedBase,
        l.freeBase,
        l.ptrPaise,
        l.mrpPaise,
        l.discountPctBp,
        l.gstRateBp,
        l.tax.taxablePaise,
        l.tax.taxPaise,
        l.tax.lineTotalPaise,
      ],
    });

    // Stock Movement (Billed + Free Bonus increment stock)
    await db.execute({
      sql: `INSERT INTO stock_movements (
        id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at
      ) VALUES (?, ?, ?, ?, 'purchase', 'PURCHASE', ?, ?)`,
      args: [`sm_pur_${Date.now()}_${idx}`, l.itemId, l.batchId, l.totalBase, purId, nowIso],
    });
  }

  // Credit ledger entry
  if (payload.paymentMode === 'credit') {
    await db.execute({
      sql: `INSERT INTO ledger_entries (
        id, party_id, date, doc_type, doc_id, debit_paise, credit_paise, narration
      ) VALUES (?, ?, ?, 'PURCHASE_INVOICE', ?, 0, ?, ?)`,
      args: [`le_${Date.now()}`, payload.supplierId, payload.invoiceDate, entryNo, summary.totalPaise, `Purchase Inv #${payload.supplierInvoiceNo}`],
    });
  }

  return { purId, entryNo, totalPaise: summary.totalPaise };
}

// ----------------------------------------------------------------------------
// 5. COMPLIANCE REGISTER SERVICE
// ----------------------------------------------------------------------------
export async function getComplianceRegister(filters: {
  schedule?: string;
  startDate?: string;
  endDate?: string;
  doctorName?: string;
}) {
  const db = await ensureDbReady();

  let sql = `
    SELECT
      sr.id, sr.date, sr.patient_name, sr.patient_address, sr.doctor_name,
      sr.doctor_reg_no, sr.item_name, sr.batch_no, sr.qty, sr.schedule,
      s.invoice_no
    FROM schedule_register sr
    JOIN sales_invoices s ON s.id = sr.sale_id
    WHERE 1=1
  `;
  const args: any[] = [];

  if (filters.schedule && filters.schedule !== 'all') {
    sql += ` AND sr.schedule = ?`;
    args.push(filters.schedule.toUpperCase());
  }
  if (filters.startDate) {
    sql += ` AND sr.date >= ?`;
    args.push(filters.startDate);
  }
  if (filters.endDate) {
    sql += ` AND sr.date <= ?`;
    args.push(filters.endDate);
  }
  if (filters.doctorName && filters.doctorName.trim()) {
    sql += ` AND sr.doctor_name LIKE ?`;
    args.push(`%${filters.doctorName.trim()}%`);
  }

  sql += ` ORDER BY sr.date DESC, sr.id DESC`;

  const rows = await db.execute({ sql, args });
  const doctorsRes = await db.execute(`SELECT DISTINCT doctor_name FROM schedule_register WHERE doctor_name != ''`);

  return {
    records: rows.rows,
    distinctDoctors: doctorsRes.rows.map((d) => String(d.doctor_name)),
  };
}

// ----------------------------------------------------------------------------
// 6. GST REPORTS SERVICE
// ----------------------------------------------------------------------------
export async function getGstReports() {
  const db = await ensureDbReady();
  const shopRes = await db.execute(`SELECT gstin, name, state_code FROM shop_profile WHERE id = 1`);
  const shop = shopRes.rows[0] || { gstin: '29AABCU9603R1ZM', name: 'PharmaPilot', state_code: '29' };

  // Outward Sales (GSTR-1)
  const salesRes = await db.execute(`
    SELECT
      s.id, s.invoice_no, s.invoice_date, s.customer_id, s.subtotal_paise,
      s.cgst_paise, s.sgst_paise, s.igst_paise, s.total_paise,
      p.name as customer_name, p.gstin as customer_gstin, p.state_code as customer_state
    FROM sales_invoices s
    LEFT JOIN parties p ON p.id = s.customer_id
    WHERE s.status = 'posted'
    ORDER BY s.invoice_date DESC
  `);

  // Inward Purchases (GSTR-3B ITC)
  const purRes = await db.execute(`
    SELECT
      p.id, p.supplier_invoice_no, p.invoice_date, p.subtotal_paise,
      p.cgst_paise, p.sgst_paise, p.igst_paise, p.total_paise,
      s.name as supplier_name, s.gstin as supplier_gstin
    FROM purchase_invoices p
    JOIN parties s ON s.id = p.supplier_id
    WHERE p.status = 'posted'
    ORDER BY p.invoice_date DESC
  `);

  // HSN Summary (Table 12)
  const hsnRes = await db.execute(`
    SELECT
      i.hsn_code,
      SUM(si.qty_base) as total_qty,
      SUM(si.taxable_paise) as taxable_paise,
      SUM(si.tax_paise) as tax_paise,
      SUM(si.line_total_paise) as total_paise
    FROM sales_items si
    JOIN items i ON i.id = si.item_id
    JOIN sales_invoices s ON s.id = si.sale_id
    WHERE s.status = 'posted'
    GROUP BY i.hsn_code
  `);

  let outwardTaxable = 0, outwardCgst = 0, outwardSgst = 0, outwardIgst = 0;
  for (const s of salesRes.rows) {
    outwardTaxable += Number(s.subtotal_paise || 0);
    outwardCgst += Number(s.cgst_paise || 0);
    outwardSgst += Number(s.sgst_paise || 0);
    outwardIgst += Number(s.igst_paise || 0);
  }
  const outwardTotalTax = outwardCgst + outwardSgst + outwardIgst;

  let itcCgst = 0, itcSgst = 0, itcIgst = 0;
  for (const p of purRes.rows) {
    itcCgst += Number(p.cgst_paise || 0);
    itcSgst += Number(p.sgst_paise || 0);
    itcIgst += Number(p.igst_paise || 0);
  }
  const totalItc = itcCgst + itcSgst + itcIgst;
  const netPayable = Math.max(0, outwardTotalTax - totalItc);

  // Prepare Official GSTR-1 Portal JSON Payload
  const gstr1Payload = {
    gstin: String(shop.gstin),
    fp: new Date().toISOString().slice(5, 7) + new Date().getFullYear(),
    gt: Number(paiseToRupeesStr(outwardTaxable + outwardTotalTax)),
    cur_gt: Number(paiseToRupeesStr(outwardTaxable + outwardTotalTax)),
    b2cs: salesRes.rows.filter((s) => !s.customer_gstin).map((s) => ({
      inv_no: s.invoice_no,
      dt: s.invoice_date,
      txval: Number(paiseToRupeesStr(Number(s.subtotal_paise))),
      camt: Number(paiseToRupeesStr(Number(s.cgst_paise))),
      samt: Number(paiseToRupeesStr(Number(s.sgst_paise))),
      iamt: Number(paiseToRupeesStr(Number(s.igst_paise))),
    })),
    hsn: {
      data: hsnRes.rows.map((h) => ({
        num: 1,
        hsn_sc: String(h.hsn_code),
        qty: Number(h.total_qty),
        uqc: 'OTH',
        txval: Number(paiseToRupeesStr(Number(h.taxable_paise))),
        camt: Number(paiseToRupeesStr(Math.floor(Number(h.tax_paise) / 2))),
        samt: Number(paiseToRupeesStr(Number(h.tax_paise) - Math.floor(Number(h.tax_paise) / 2))),
        iamt: 0,
      })),
    },
  };

  return {
    shop,
    outward: {
      taxablePaise: outwardTaxable,
      cgstPaise: outwardCgst,
      sgstPaise: outwardSgst,
      igstPaise: outwardIgst,
      totalTaxPaise: outwardTotalTax,
      sales: salesRes.rows,
    },
    itc: {
      cgstPaise: itcCgst,
      sgstPaise: itcSgst,
      igstPaise: itcIgst,
      totalItcPaise: totalItc,
      purchases: purRes.rows,
    },
    netPayablePaise: netPayable,
    hsnSummary: hsnRes.rows,
    gstr1Payload,
  };
}

// ----------------------------------------------------------------------------
// 7. IMPORT WIZARD SERVICE
// ----------------------------------------------------------------------------
export async function getImportJobs() {
  const db = await ensureDbReady();
  const jobsRes = await db.execute(`SELECT * FROM import_jobs ORDER BY created_at DESC`);
  return jobsRes.rows.map((j) => ({
    ...j,
    createdIds: JSON.parse(String(j.created_ids_json || '{}')),
  }));
}

export async function commitImportJob(params: {
  filename: string;
  type: string;
  rows: Array<{
    name: string;
    genericName?: string;
    manufacturer?: string;
    batchNo: string;
    expiryDate: string;
    mrpPaise: number;
    ptrPaise: number;
    qtyBase: number;
    packing?: string;
    hsn?: string;
    gstRateBp?: number;
    schedule?: string;
    rack?: string;
  }>;
}) {
  const db = await ensureDbReady();
  const nowIso = new Date().toISOString();
  const createdIds: { items: string[]; batches: string[]; movements: string[] } = {
    items: [],
    batches: [],
    movements: [],
  };

  for (const r of params.rows) {
    const mfrName = (r.manufacturer || 'General Pharma').trim();
    let mfrRes = await db.execute({ sql: `SELECT id FROM manufacturers WHERE name = ?`, args: [mfrName] });
    let mfrId = mfrRes.rows[0]?.id ? String(mfrRes.rows[0].id) : '';
    if (!mfrId) {
      mfrId = `mfr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.execute({ sql: `INSERT INTO manufacturers (id, name, is_active) VALUES (?, ?, 1)`, args: [mfrId, mfrName] });
    }

    let itemRes = await db.execute({ sql: `SELECT id FROM items WHERE name = ?`, args: [r.name.trim()] });
    let itemId = itemRes.rows[0]?.id ? String(itemRes.rows[0].id) : '';
    if (!itemId) {
      itemId = `itm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.execute({
        sql: `INSERT INTO items (
          id, name, generic_name, manufacturer_id, category, drug_form, hsn_code, gst_rate_bp,
          schedule, base_unit, rack_location, reorder_level, reorder_qty, barcode, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'Medicine', 'Tablet', ?, ?, ?, 'TAB', ?, 20, 100, '', 1, ?, ?)`,
        args: [
          itemId,
          r.name.trim(),
          r.genericName || '',
          mfrId,
          r.hsn || '3004',
          r.gstRateBp || 1200,
          r.schedule || 'none',
          r.rack || 'R-01',
          nowIso,
          nowIso,
        ],
      });
      createdIds.items.push(itemId);

      // Default unit
      await db.execute({
        sql: `INSERT INTO item_units (id, item_id, unit_name, qty_in_base_unit, is_default_sale, is_default_purchase)
              VALUES (?, ?, 'STRIP', 10, 1, 1)`,
        args: [`u_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`, itemId],
      });
    }

    const batchNo = r.batchNo.trim().toUpperCase() || 'OPEN-01';
    let batchRes = await db.execute({
      sql: `SELECT id FROM batches WHERE item_id = ? AND batch_no = ? AND mrp_paise = ?`,
      args: [itemId, batchNo, r.mrpPaise],
    });
    let batchId = batchRes.rows[0]?.id ? String(batchRes.rows[0].id) : '';
    if (!batchId) {
      batchId = `bat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.execute({
        sql: `INSERT INTO batches (
          id, item_id, batch_no, expiry_date, mrp_paise, ptr_paise, pts_paise, purchase_rate_paise, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [batchId, itemId, batchNo, r.expiryDate, r.mrpPaise, r.ptrPaise, r.ptrPaise, r.ptrPaise, nowIso],
      });
      createdIds.batches.push(batchId);
    }

    if (r.qtyBase > 0) {
      const smId = `sm_imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.execute({
        sql: `INSERT INTO stock_movements (
          id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at
        ) VALUES (?, ?, ?, ?, 'opening', 'IMPORT', ?, ?)`,
        args: [smId, itemId, batchId, r.qtyBase, params.filename, nowIso],
      });
      createdIds.movements.push(smId);
    }
  }

  const jobId = `imp_${Date.now()}`;
  await db.execute({
    sql: `INSERT INTO import_jobs (
      id, type, filename, mapping_json, total_rows, ok_rows, failed_rows, status, created_ids_json, created_at
    ) VALUES (?, ?, ?, '{}', ?, ?, 0, 'committed', ?, ?)`,
    args: [jobId, params.type, params.filename, params.rows.length, params.rows.length, JSON.stringify(createdIds), nowIso],
  });

  return { jobId, okCount: params.rows.length };
}

export async function undoImportJob(jobId: string) {
  const db = await ensureDbReady();
  const jobRes = await db.execute({ sql: `SELECT * FROM import_jobs WHERE id = ?`, args: [jobId] });
  const job = jobRes.rows[0];
  if (!job) throw new Error('Import job not found.');
  if (job.status === 'reverted') throw new Error('Job has already been reverted.');

  const createdIds = JSON.parse(String(job.created_ids_json || '{}'));
  const batchIds: string[] = createdIds.batches || [];

  // Check if any batch was already dispensed on a sales invoice
  if (batchIds.length > 0) {
    const placeholders = batchIds.map(() => '?').join(',');
    const saleCheck = await db.execute({
      sql: `SELECT id FROM sales_items WHERE batch_id IN (${placeholders}) LIMIT 1`,
      args: batchIds,
    });
    if (saleCheck.rows.length > 0) {
      throw new Error('Cannot undo import: one or more imported batches have already been sold on customer invoices.');
    }
  }

  for (const smId of createdIds.movements || []) {
    await db.execute({ sql: `DELETE FROM stock_movements WHERE id = ?`, args: [smId] });
  }
  for (const bId of createdIds.batches || []) {
    await db.execute({ sql: `DELETE FROM batches WHERE id = ?`, args: [bId] });
  }
  for (const iId of createdIds.items || []) {
    await db.execute({ sql: `DELETE FROM item_units WHERE item_id = ?`, args: [iId] });
    await db.execute({ sql: `DELETE FROM items WHERE id = ?`, args: [iId] });
  }

  await db.execute({ sql: `UPDATE import_jobs SET status = 'reverted' WHERE id = ?`, args: [jobId] });
  return { success: true };
}

// ----------------------------------------------------------------------------
// 8. ACCOUNTS & DAY BOOK SERVICE
// ----------------------------------------------------------------------------
export async function getAccountsData(partyId?: string) {
  const db = await ensureDbReady();
  const todayIso = new Date().toISOString().slice(0, 10);

  // Parties & Balances
  const partiesRes = await db.execute(`
    SELECT id, name, type, phone, address, gstin, opening_balance_paise, opening_balance_type
    FROM parties WHERE is_active = 1 ORDER BY name ASC
  `);

  const ledgerSumRes = await db.execute(`
    SELECT party_id, SUM(debit_paise) as total_debit, SUM(credit_paise) as total_credit
    FROM ledger_entries GROUP BY party_id
  `);
  const ledgerMap = new Map<string, { debit: number; credit: number }>();
  for (const r of ledgerSumRes.rows) {
    ledgerMap.set(String(r.party_id), { debit: Number(r.total_debit || 0), credit: Number(r.total_credit || 0) });
  }

  const partyBalances = partiesRes.rows.map((p) => {
    const id = String(p.id);
    const led = ledgerMap.get(id) || { debit: 0, credit: 0 };
    const opBal = p.opening_balance_type === 'cr' ? -Number(p.opening_balance_paise || 0) : Number(p.opening_balance_paise || 0);
    const net = opBal + led.debit - led.credit;
    return {
      id,
      name: String(p.name),
      type: String(p.type),
      phone: String(p.phone || ''),
      balancePaise: Math.abs(net),
      nature: net >= 0 ? 'dr' : 'cr',
    };
  });

  // Customer Credit Ageing (0-30, 31-60, 61-90, 90+ days)
  const salesWithDuesRes = await db.execute(`
    SELECT
      s.id, s.invoice_no, s.invoice_date, s.customer_id, s.total_paise, s.paid_paise,
      p.name as customer_name, p.phone as customer_phone
    FROM sales_invoices s
    JOIN parties p ON p.id = s.customer_id
    WHERE s.status = 'posted' AND s.payment_mode = 'credit' AND s.total_paise > s.paid_paise
  `);

  const ageingBuckets = {
    bucket0to30: 0,
    bucket31to60: 0,
    bucket61to90: 0,
    bucket90Plus: 0,
    invoices: [] as any[],
  };

  const msInDay = 24 * 60 * 60 * 1000;
  const todayMs = new Date(todayIso + 'T00:00:00Z').getTime();

  for (const s of salesWithDuesRes.rows) {
    const duePaise = Number(s.total_paise) - Number(s.paid_paise);
    const invMs = new Date(String(s.invoice_date) + 'T00:00:00Z').getTime();
    const daysOld = Math.max(0, Math.floor((todayMs - invMs) / msInDay));

    if (daysOld <= 30) ageingBuckets.bucket0to30 += duePaise;
    else if (daysOld <= 60) ageingBuckets.bucket31to60 += duePaise;
    else if (daysOld <= 90) ageingBuckets.bucket61to90 += duePaise;
    else ageingBuckets.bucket90Plus += duePaise;

    ageingBuckets.invoices.push({
      id: s.id,
      invoiceNo: s.invoice_no,
      invoiceDate: s.invoice_date,
      customerName: s.customer_name,
      customerPhone: s.customer_phone,
      duePaise,
      daysOld,
    });
  }

  // Day Book Cash Drawer Breakdown
  const cashSalesRes = await db.execute(`SELECT COALESCE(SUM(paid_paise), 0) as amt FROM sales_invoices WHERE status = 'posted' AND payment_mode = 'cash'`);
  const cashPurchasesRes = await db.execute(`SELECT COALESCE(SUM(paid_paise), 0) as amt FROM purchase_invoices WHERE status = 'posted' AND payment_mode = 'cash'`);
  const cashExpensesRes = await db.execute(`SELECT COALESCE(SUM(amount_paise), 0) as amt FROM expenses WHERE mode = 'cash'`);

  const cashSales = Number(cashSalesRes.rows[0]?.amt || 0);
  const cashPurchases = Number(cashPurchasesRes.rows[0]?.amt || 0);
  const cashExpenses = Number(cashExpensesRes.rows[0]?.amt || 0);
  const netCash = cashSales - cashPurchases - cashExpenses;

  // Selected party ledger statement
  let selectedPartyLedger: any[] = [];
  const activePartyId = partyId || String(partiesRes.rows[0]?.id || '');
  if (activePartyId) {
    const entriesRes = await db.execute({
      sql: `SELECT * FROM ledger_entries WHERE party_id = ? ORDER BY date ASC, id ASC`,
      args: [activePartyId],
    });
    selectedPartyLedger = entriesRes.rows;
  }

  // Expenses list
  const expensesRes = await db.execute(`SELECT * FROM expenses ORDER BY date DESC, id DESC LIMIT 20`);

  return {
    parties: partiesRes.rows,
    partyBalances,
    ageingBuckets,
    cashBook: {
      cashSales,
      cashPurchases,
      cashExpenses,
      netCash,
    },
    selectedPartyId: activePartyId,
    selectedPartyLedger,
    expenses: expensesRes.rows,
  };
}

export async function createExpense(params: {
  date: string;
  category: string;
  amountPaise: number;
  mode: string;
  notes: string;
}) {
  const db = await ensureDbReady();
  const id = `exp_${Date.now()}`;
  await db.execute({
    sql: `INSERT INTO expenses (id, date, category, amount_paise, mode, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, params.date, params.category, params.amountPaise, params.mode, params.notes || ''],
  });
  return { id };
}
