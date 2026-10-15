// src/lib/db-service.ts — Domain Database Service for PharmaPilot Next
import { getDb, initDatabase } from './db';
import { seedDatabase } from './seed';
import { computeLineTax, summarizeInvoiceTax } from './gst';
import { allocateFEFO } from './fefo';
import { validatePrescriptionCompliance, isRestrictedSchedule } from './compliance';
import { isBatchExpired, daysUntilExpiry, parseExpiryInput } from './dates';
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
    // Ensure items_fts is synced if items exist
    try {
      const ftsCheck = await db.execute('SELECT COUNT(*) as cnt FROM items_fts');
      if (Number(ftsCheck.rows[0]?.cnt || 0) === 0 && Number(check.rows[0]?.cnt || 0) > 0) {
        await db.execute(
          'INSERT OR IGNORE INTO items_fts(rowid, item_id, name, generic_name, barcode) SELECT rowid, id, name, generic_name, barcode FROM items'
        );
      }
    } catch {
      // Ignore sync error if FTS already populated
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
export async function getPosCatalog(limit: number = 50) {
  const db = await ensureDbReady();

  // Active items limited for high performance
  const itemsRes = await db.execute({
    sql: `
      SELECT
        i.id, i.name, i.generic_name, i.category, i.drug_form, i.hsn_code,
        i.gst_rate_bp, i.schedule, i.base_unit, i.rack_location, i.barcode,
        m.name as manufacturer_name
      FROM items i
      LEFT JOIN manufacturers m ON m.id = i.manufacturer_id
      WHERE i.is_active = 1
      ORDER BY i.name ASC
      LIMIT ?
    `,
    args: [limit],
  });

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

/**
 * High-Scale Server-Side Debounced Full-Text Search using SQLite FTS5.
 * Searches item name, generic/salt formulation, barcode, or prefix in <5ms.
 * Returns items joined with active batches and live v_batch_stock.
 */
export async function searchPosItemsFTS(query: string, limit: number = 25) {
  const db = await ensureDbReady();
  const rawQ = (query || '').trim();
  const cleanQ = rawQ.replace(/^\d+\s*\*\s*/, '').trim();

  let matchedItemIds: string[] = [];

  if (!cleanQ) {
    const topRes = await db.execute({
      sql: `SELECT id FROM items WHERE is_active = 1 ORDER BY name ASC LIMIT ?`,
      args: [limit],
    });
    matchedItemIds = topRes.rows.map((r) => String(r.id));
  } else {
    // 1. Try SQLite FTS5 MATCH on items_fts
    const tokens = cleanQ
      .split(/\s+/)
      .map((t) => t.replace(/[^a-zA-Z0-9]/g, ''))
      .filter(Boolean);

    const ftsItemIds: string[] = [];
    if (tokens.length > 0) {
      const ftsPattern = tokens.map((t) => `"${t}"*`).join(' AND ');
      try {
        const ftsRes = await db.execute({
          sql: `SELECT item_id, rank FROM items_fts WHERE items_fts MATCH ? ORDER BY rank ASC LIMIT ?`,
          args: [ftsPattern, limit],
        });
        for (const row of ftsRes.rows) {
          ftsItemIds.push(String(row.item_id));
        }
      } catch (err) {
        // Fallback below
      }
    }

    // 2. Barcode match
    const barcodeRes = await db.execute({
      sql: `SELECT id FROM items WHERE is_active = 1 AND (barcode = ? OR barcode LIKE ?) LIMIT ?`,
      args: [cleanQ, `${cleanQ}%`, Math.min(5, limit)],
    });
    const barcodeItemIds = barcodeRes.rows.map((r) => String(r.id));

    // 3. Batch number match
    const batchRes = await db.execute({
      sql: `SELECT DISTINCT item_id FROM batches WHERE batch_no = ? OR batch_no LIKE ? LIMIT ?`,
      args: [cleanQ, `${cleanQ}%`, Math.min(5, limit)],
    });
    const batchItemIds = batchRes.rows.map((r) => String(r.item_id));

    // Combine in priority order: FTS rank > Barcode match > Batch match
    const combinedSet = new Set<string>();
    for (const id of ftsItemIds) combinedSet.add(id);
    for (const id of barcodeItemIds) combinedSet.add(id);
    for (const id of batchItemIds) combinedSet.add(id);

    // 4. Fallback LIKE if still empty
    if (combinedSet.size === 0) {
      const likeRes = await db.execute({
        sql: `SELECT id FROM items WHERE is_active = 1 AND (name LIKE ? OR generic_name LIKE ?) LIMIT ?`,
        args: [`%${cleanQ}%`, `%${cleanQ}%`, limit],
      });
      for (const r of likeRes.rows) combinedSet.add(String(r.id));
    }

    matchedItemIds = Array.from(combinedSet).slice(0, limit);
  }

  if (matchedItemIds.length === 0) {
    return [];
  }

  const placeholders = matchedItemIds.map(() => '?').join(',');
  const itemsRes = await db.execute({
    sql: `
      SELECT
        i.id, i.name, i.generic_name, i.category, i.drug_form, i.hsn_code,
        i.gst_rate_bp, i.schedule, i.base_unit, i.rack_location, i.barcode,
        m.name as manufacturer_name
      FROM items i
      LEFT JOIN manufacturers m ON m.id = i.manufacturer_id
      WHERE i.id IN (${placeholders})
    `,
    args: matchedItemIds,
  });

  const unitsRes = await db.execute({
    sql: `
      SELECT id, item_id, unit_name, qty_in_base_unit, is_default_sale
      FROM item_units
      WHERE item_id IN (${placeholders})
    `,
    args: matchedItemIds,
  });
  const unitsMap = new Map<string, any[]>();
  for (const u of unitsRes.rows) {
    const list = unitsMap.get(String(u.item_id)) || [];
    list.push(u);
    unitsMap.set(String(u.item_id), list);
  }

  const batchesRes = await db.execute({
    sql: `
      SELECT
        b.id, b.item_id, b.batch_no, b.expiry_date, b.mrp_paise, b.ptr_paise,
        v.current_qty_base
      FROM batches b
      JOIN v_batch_stock v ON v.batch_id = b.id
      WHERE b.item_id IN (${placeholders})
      ORDER BY b.expiry_date ASC
    `,
    args: matchedItemIds,
  });
  const batchMap = new Map<string, any[]>();
  for (const b of batchesRes.rows) {
    const list = batchMap.get(String(b.item_id)) || [];
    list.push({
      id: String(b.id),
      itemId: String(b.item_id),
      batchNo: String(b.batch_no),
      expiryDate: String(b.expiry_date),
      mrpPaise: Number(b.mrp_paise),
      ptrPaise: Number(b.ptr_paise),
      availableQtyBase: Number(b.current_qty_base || 0),
    });
    batchMap.set(String(b.item_id), list);
  }

  const itemsMap = new Map<string, any>();
  for (const row of itemsRes.rows) {
    const id = String(row.id);
    const units = unitsMap.get(id) || [];
    const defaultUnit = units.find((u) => u.is_default_sale) || units[0] || { unit_name: row.base_unit, qty_in_base_unit: 1 };
    const batches = batchMap.get(id) || [];
    const totalStock = batches.reduce((sum, b) => sum + b.availableQtyBase, 0);

    itemsMap.set(id, {
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
    });
  }

  // Preserve priority order
  return matchedItemIds
    .map((id) => itemsMap.get(id))
    .filter(Boolean);
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
    unitMode?: 'pack' | 'loose';
    qty?: number;
    qtyBase?: number;
    discountPct?: number;
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

    const lineQty = Number(line.qty ?? line.qtyBase ?? 1);
    const qtyBase = line.unitMode === 'pack' ? lineQty * packSize : Number(line.qtyBase ?? lineQty);
    const availBase = Number(batch.current_qty_base || 0);

    if (qtyBase > availBase) {
      throw new Error(`Oversell prevented: Batch ${batch.batch_no} has only ${availBase} base units, requested ${qtyBase}.`);
    }

    const unitMrpPaise = line.unitMode === 'pack' ? Number(batch.mrp_paise) : Math.round(Number(batch.mrp_paise) / packSize);
    const discBp = Math.round((Number(line.discountPct) || 0) * 100);

    const tax = computeLineTax({
      qty: lineQty,
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

export interface ProcessSalesReturnPayload {
  originalInvoiceNo?: string;
  customerId?: string;
  refundMode: 'cash' | 'credit';
  reason: string;
  items: Array<{
    itemId: string;
    batchId: string;
    qtyBase: number;
    ratePaise: number;
    disposition: 'restock' | 'damage' | 'expiry_writeoff';
  }>;
}

/**
 * Process Sales Return / Customer Credit Note (Grahak Wapsi).
 * - Restores stock to batches if disposition == 'restock' via stock_movements (movement_type: 'sale_return').
 * - Inserts credit into ledger_entries if refundMode == 'credit' to reduce customer balance.
 * - Generates sequence return number (SRN-YYYY-XXXX).
 */
export async function processSalesReturn(payload: ProcessSalesReturnPayload) {
  const db = await ensureDbReady();
  const todayIso = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  if (!payload.items || payload.items.length === 0) {
    throw new Error('At least one item is required for a sales return.');
  }

  for (const item of payload.items) {
    if (!item.qtyBase || item.qtyBase <= 0) {
      throw new Error(`Invalid return quantity (${item.qtyBase}) for item ${item.itemId}`);
    }
    if (item.ratePaise < 0) {
      throw new Error(`Invalid return rate (${item.ratePaise}) for item ${item.itemId}`);
    }
  }

  // 1. Resolve Shop Profile
  const shopRes = await db.execute(`SELECT * FROM shop_profile WHERE id = 1`);
  const shop = shopRes.rows[0] || { state_code: '29', gstin: '', name: 'PharmaPilot' };
  const shopState = String(shop.state_code || '29');

  // 2. Resolve Original Invoice & Customer ID
  let originalSaleId: string | null = null;
  let customerId = payload.customerId || null;

  if (payload.originalInvoiceNo) {
    const saleRes = await db.execute({
      sql: `SELECT id, customer_id FROM sales_invoices WHERE UPPER(invoice_no) = ?`,
      args: [payload.originalInvoiceNo.trim().toUpperCase()],
    });
    if (saleRes.rows.length > 0) {
      originalSaleId = String(saleRes.rows[0].id);
      if (!customerId && saleRes.rows[0].customer_id) {
        customerId = String(saleRes.rows[0].customer_id);
      }
    }
  }

  if (payload.refundMode === 'credit' && !customerId) {
    throw new Error('Customer credit refund requires a registered customer account.');
  }

  let custState = shopState;
  if (customerId) {
    const custRes = await db.execute({
      sql: `SELECT state_code FROM parties WHERE id = ?`,
      args: [customerId],
    });
    if (custRes.rows[0]?.state_code) {
      custState = String(custRes.rows[0].state_code);
    }
  }

  // 3. Compute Line Taxes and Totals
  let subtotalPaise = 0;
  let taxPaise = 0;
  let totalPaise = 0;
  const processedLines: any[] = [];

  for (const line of payload.items) {
    const itemRes = await db.execute({
      sql: `SELECT id, name, gst_rate_bp, base_unit FROM items WHERE id = ?`,
      args: [line.itemId],
    });
    const itemRow = itemRes.rows[0];
    if (!itemRow) throw new Error(`Medicine not found: ${line.itemId}`);

    const batchRes = await db.execute({
      sql: `SELECT id, batch_no, expiry_date FROM batches WHERE id = ?`,
      args: [line.batchId],
    });
    const batchRow = batchRes.rows[0];
    if (!batchRow) throw new Error(`Batch not found: ${line.batchId}`);

    const gstRateBp = Number(itemRow.gst_rate_bp || 1200);
    const tax = computeLineTax({
      qty: line.qtyBase,
      ratePaise: line.ratePaise,
      discountPctBp: 0,
      gstRateBp,
      taxInclusive: true,
      shopStateCode: shopState,
      partyStateCode: custState,
    });

    subtotalPaise += tax.taxablePaise;
    taxPaise += tax.taxPaise;
    totalPaise += tax.lineTotalPaise;

    processedLines.push({
      itemId: line.itemId,
      batchId: line.batchId,
      qtyBase: line.qtyBase,
      ratePaise: line.ratePaise,
      taxablePaise: tax.taxablePaise,
      taxPaise: tax.taxPaise,
      lineTotalPaise: tax.lineTotalPaise,
      disposition: line.disposition || 'restock',
      itemName: String(itemRow.name),
      batchNo: String(batchRow.batch_no),
      expiryDate: String(batchRow.expiry_date),
      baseUnit: String(itemRow.base_unit || 'TAB'),
    });
  }

  // 4. Generate Sequence Return Number (e.g. SRN-2026-0001)
  const year = new Date().getFullYear();
  const countRes = await db.execute(`SELECT COUNT(*) as cnt FROM sales_returns`);
  const seq = Number(countRes.rows[0]?.cnt || 0) + 1;
  const returnNo = `SRN-${year}-${String(seq).padStart(4, '0')}`;
  const returnId = `sr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // 5. Insert into sales_returns
  await db.execute({
    sql: `INSERT INTO sales_returns (
      id, return_no, return_date, original_sale_id, customer_id, reason,
      refund_mode, subtotal_paise, tax_paise, total_paise, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    args: [
      returnId,
      returnNo,
      todayIso,
      originalSaleId,
      customerId,
      payload.reason || 'Customer Return',
      payload.refundMode,
      subtotalPaise,
      taxPaise,
      totalPaise,
      nowIso,
    ],
  });

  // 6. Insert return items and handle stock movement if disposition == 'restock'
  for (let idx = 0; idx < processedLines.length; idx++) {
    const l = processedLines[idx];
    const returnItemId = `sri_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`;

    await db.execute({
      sql: `INSERT INTO sales_return_items (
        id, return_id, item_id, batch_id, qty_base, rate_paise,
        tax_paise, line_total_paise, disposition
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        returnItemId,
        returnId,
        l.itemId,
        l.batchId,
        l.qtyBase,
        l.ratePaise,
        l.taxPaise,
        l.lineTotalPaise,
        l.disposition,
      ],
    });

    // If disposition == 'restock', insert into stock_movements with positive qty (+qtyBase)
    if (l.disposition === 'restock') {
      const smId = `sm_srn_${Date.now()}_${idx}`;
      await db.execute({
        sql: `INSERT INTO stock_movements (
          id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at
        ) VALUES (?, ?, ?, ?, 'sale_return', 'sale_return', ?, ?)`,
        args: [
          smId,
          l.itemId,
          l.batchId,
          l.qtyBase,
          returnNo,
          nowIso,
        ],
      });
    }
  }

  // 7. If refundMode == 'credit' and customerId exists, credit customer ledger to reduce customer balance
  if (payload.refundMode === 'credit' && customerId) {
    const leId = `le_srn_${Date.now()}`;
    await db.execute({
      sql: `INSERT INTO ledger_entries (
        id, party_id, date, doc_type, doc_id, debit_paise, credit_paise, narration
      ) VALUES (?, ?, ?, 'SALE_RETURN', ?, 0, ?, ?)`,
      args: [
        leId,
        customerId,
        todayIso,
        returnNo,
        totalPaise,
        `Credit Note #${returnNo} (Sales Return: ${payload.reason || 'Patient Return'})`,
      ],
    });
  }

  return {
    success: true,
    returnId,
    returnNo,
    returnDate: todayIso,
    originalInvoiceNo: payload.originalInvoiceNo || null,
    customerId,
    refundMode: payload.refundMode,
    reason: payload.reason,
    subtotalPaise,
    taxPaise,
    totalPaise,
    items: processedLines,
  };
}

/**
 * Fetch recent sales returns with their line items
 */
export async function getRecentSalesReturns(limit: number = 20) {
  const db = await ensureDbReady();
  const res = await db.execute({
    sql: `
      SELECT
        sr.id, sr.return_no, sr.return_date, sr.reason, sr.refund_mode,
        sr.subtotal_paise, sr.tax_paise, sr.total_paise, sr.created_at,
        p.id as customer_id, p.name as customer_name, p.phone as customer_phone,
        si.invoice_no as original_invoice_no
      FROM sales_returns sr
      LEFT JOIN parties p ON p.id = sr.customer_id
      LEFT JOIN sales_invoices si ON si.id = sr.original_sale_id
      ORDER BY sr.created_at DESC
      LIMIT ?
    `,
    args: [limit],
  });

  const returns = [];
  for (const row of res.rows) {
    const itemsRes = await db.execute({
      sql: `
        SELECT
          sri.id, sri.item_id, sri.batch_id, sri.qty_base, sri.rate_paise,
          sri.tax_paise, sri.line_total_paise, sri.disposition,
          i.name as item_name, i.base_unit, b.batch_no, b.expiry_date
        FROM sales_return_items sri
        JOIN items i ON i.id = sri.item_id
        JOIN batches b ON b.id = sri.batch_id
        WHERE sri.return_id = ?
      `,
      args: [row.id],
    });
    returns.push({
      ...row,
      items: itemsRes.rows,
    });
  }
  return returns;
}

/**
 * Lookup past bill details and items by invoice number to streamline returns
 */
export async function getSaleInvoiceForReturn(invoiceNo: string) {
  const db = await ensureDbReady();
  const cleanNo = invoiceNo.trim().toUpperCase();
  const saleRes = await db.execute({
    sql: `
      SELECT
        s.id, s.invoice_no, s.invoice_date, s.customer_id, s.patient_name,
        s.patient_address, s.subtotal_paise, s.discount_paise, s.total_paise, s.payment_mode,
        p.name as customer_name, p.phone as customer_phone
      FROM sales_invoices s
      LEFT JOIN parties p ON p.id = s.customer_id
      WHERE UPPER(s.invoice_no) = ? OR s.id = ?
    `,
    args: [cleanNo, cleanNo],
  });

  const sale = saleRes.rows[0];
  if (!sale) return null;

  const itemsRes = await db.execute({
    sql: `
      SELECT
        si.id as sale_item_id, si.item_id, si.batch_id, si.qty_base, si.rate_paise,
        si.mrp_paise, si.line_total_paise, si.gst_rate_bp,
        i.name as item_name, i.base_unit, b.batch_no, b.expiry_date,
        u.unit_name as sale_unit, u.qty_in_base_unit as pack_size
      FROM sales_items si
      JOIN items i ON i.id = si.item_id
      JOIN batches b ON b.id = si.batch_id
      LEFT JOIN item_units u ON u.item_id = i.id AND u.is_default_sale = 1
      WHERE si.sale_id = ?
    `,
    args: [sale.id],
  });

  return {
    sale,
    items: itemsRes.rows,
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
      i.id, i.name, i.generic_name, i.category, i.drug_form, i.hsn_code,
      i.gst_rate_bp, i.schedule, i.base_unit, i.rack_location, i.barcode,
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
      category: String(row.category || 'Medicine'),
      drugForm: String(row.drug_form || 'Tablet'),
      hsnCode: String(row.hsn_code || '3004'),
      gstRateBp: Number(row.gst_rate_bp || 1200),
      rackLocation: String(row.rack_location || '—'),
      schedule: String(row.schedule),
      baseUnit: String(row.base_unit),
      saleUnit: u.unitName,
      packSize: u.packSize,
      reorderLevel: Number(row.reorder_level || 20),
      reorderQty: Number(row.reorder_qty || 100),
      barcode: String(row.barcode || ''),
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
// MEDICINE MASTER SERVICES
// ----------------------------------------------------------------------------
export interface CreateMedicineMasterPayload {
  name: string;
  genericName?: string;
  manufacturerName?: string;
  manufacturerId?: string;
  category?: string;
  drugForm?: string;
  hsnCode?: string;
  gstRateBp?: number;
  schedule?: 'none' | 'H' | 'H1' | 'X' | 'NDPS' | 'OTC';
  baseUnit?: string;
  packUnit?: string;
  packSize?: number;
  rackLocation?: string;
  reorderLevel?: number;
  reorderQty?: number;
  barcode?: string;
  notes?: string;
  initialBatch?: {
    batchNo: string;
    expiryDate: string;
    mrpPaise?: number;
    mrp?: number;
    ptrPaise?: number;
    ptr?: number;
    quantity?: number;
  };
}

export async function createMedicineMaster(payload: CreateMedicineMasterPayload) {
  const db = await ensureDbReady();
  const cleanName = (payload.name || '').trim();
  if (!cleanName) {
    throw new Error('Medicine name is required.');
  }

  const nowIso = new Date().toISOString();

  // Handle manufacturer auto-insertion
  let mfrId = payload.manufacturerId || null;
  const cleanMfr = (payload.manufacturerName || '').trim();
  if (!mfrId && cleanMfr) {
    const existingMfr = await db.execute({
      sql: 'SELECT id FROM manufacturers WHERE LOWER(name) = LOWER(?)',
      args: [cleanMfr],
    });
    if (existingMfr.rows[0]?.id) {
      mfrId = String(existingMfr.rows[0].id);
    } else {
      mfrId = `mfr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.execute({
        sql: 'INSERT INTO manufacturers (id, name, is_active, created_at) VALUES (?, ?, 1, ?)',
        args: [mfrId, cleanMfr, nowIso],
      });
    }
  }

  const itemId = `med_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const baseUnit = (payload.baseUnit || 'TAB').trim().toUpperCase();
  const packSize = Number(payload.packSize) > 0 ? Number(payload.packSize) : 1;
  const packUnit = (payload.packUnit || (packSize > 1 ? 'STRIP' : baseUnit)).trim().toUpperCase();

  await db.execute({
    sql: `INSERT INTO items (
      id, name, generic_name, manufacturer_id, category, drug_form,
      hsn_code, gst_rate_bp, schedule, base_unit, rack_location,
      reorder_level, reorder_qty, barcode, notes, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    args: [
      itemId,
      cleanName,
      (payload.genericName || '').trim(),
      mfrId,
      (payload.category || 'Medicine').trim(),
      (payload.drugForm || 'Tablet').trim(),
      (payload.hsnCode || '3004').trim(),
      Number(payload.gstRateBp) || 1200,
      payload.schedule || 'none',
      baseUnit,
      (payload.rackLocation || '').trim().toUpperCase(),
      Number(payload.reorderLevel) >= 0 ? Number(payload.reorderLevel) : 20,
      Number(payload.reorderQty) >= 0 ? Number(payload.reorderQty) : 100,
      (payload.barcode || '').trim(),
      (payload.notes || '').trim(),
      nowIso,
      nowIso,
    ],
  });

  // Default sale and purchase pack unit
  const unitId = `u_${itemId}_01`;
  await db.execute({
    sql: `INSERT INTO item_units (id, item_id, unit_name, qty_in_base_unit, is_default_sale, is_default_purchase)
          VALUES (?, ?, ?, ?, 1, 1)`,
    args: [unitId, itemId, packUnit, packSize],
  });

  let initialBatchResult = null;
  if (payload.initialBatch && payload.initialBatch.batchNo && payload.initialBatch.expiryDate) {
    initialBatchResult = await createOrRestockBatch({
      itemId,
      batchNo: payload.initialBatch.batchNo,
      expiryDate: payload.initialBatch.expiryDate,
      mrpPaise: payload.initialBatch.mrpPaise,
      mrp: payload.initialBatch.mrp,
      ptrPaise: payload.initialBatch.ptrPaise,
      ptr: payload.initialBatch.ptr,
      quantity: payload.initialBatch.quantity || 0,
      movementType: 'opening',
    });
  }

  return {
    success: true,
    id: itemId,
    name: cleanName,
    manufacturerId: mfrId,
    initialBatch: initialBatchResult,
  };
}

export interface UpdateMedicineMasterPayload {
  name?: string;
  genericName?: string;
  manufacturerName?: string;
  manufacturerId?: string;
  category?: string;
  drugForm?: string;
  hsnCode?: string;
  gstRateBp?: number;
  schedule?: 'none' | 'H' | 'H1' | 'X' | 'NDPS' | 'OTC';
  baseUnit?: string;
  packUnit?: string;
  packSize?: number;
  rackLocation?: string;
  reorderLevel?: number;
  reorderQty?: number;
  barcode?: string;
  notes?: string;
}

export async function updateMedicineMaster(id: string, payload: UpdateMedicineMasterPayload) {
  const db = await ensureDbReady();
  const existingRes = await db.execute({ sql: `SELECT * FROM items WHERE id = ?`, args: [id] });
  const existing = existingRes.rows[0];
  if (!existing) {
    throw new Error(`Medicine master ${id} not found.`);
  }

  const nowIso = new Date().toISOString();

  let mfrId = payload.manufacturerId !== undefined ? payload.manufacturerId : existing.manufacturer_id;
  const cleanMfr = (payload.manufacturerName || '').trim();
  if (cleanMfr && cleanMfr !== existing.manufacturer_id) {
    const mfrRes = await db.execute({
      sql: 'SELECT id FROM manufacturers WHERE LOWER(name) = LOWER(?)',
      args: [cleanMfr],
    });
    if (mfrRes.rows[0]?.id) {
      mfrId = String(mfrRes.rows[0].id);
    } else {
      mfrId = `mfr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.execute({
        sql: 'INSERT INTO manufacturers (id, name, is_active, created_at) VALUES (?, ?, 1, ?)',
        args: [mfrId, cleanMfr, nowIso],
      });
    }
  }

  await db.execute({
    sql: `UPDATE items SET
      name = COALESCE(?, name),
      generic_name = COALESCE(?, generic_name),
      manufacturer_id = ?,
      category = COALESCE(?, category),
      drug_form = COALESCE(?, drug_form),
      hsn_code = COALESCE(?, hsn_code),
      gst_rate_bp = COALESCE(?, gst_rate_bp),
      schedule = COALESCE(?, schedule),
      base_unit = COALESCE(?, base_unit),
      rack_location = COALESCE(?, rack_location),
      reorder_level = COALESCE(?, reorder_level),
      reorder_qty = COALESCE(?, reorder_qty),
      barcode = COALESCE(?, barcode),
      notes = COALESCE(?, notes),
      updated_at = ?
    WHERE id = ?`,
    args: [
      payload.name?.trim() || null,
      payload.genericName !== undefined ? payload.genericName.trim() : null,
      mfrId,
      payload.category?.trim() || null,
      payload.drugForm?.trim() || null,
      payload.hsnCode?.trim() || null,
      payload.gstRateBp !== undefined ? Number(payload.gstRateBp) : null,
      payload.schedule || null,
      payload.baseUnit?.trim().toUpperCase() || null,
      payload.rackLocation !== undefined ? payload.rackLocation.trim().toUpperCase() : null,
      payload.reorderLevel !== undefined ? Number(payload.reorderLevel) : null,
      payload.reorderQty !== undefined ? Number(payload.reorderQty) : null,
      payload.barcode !== undefined ? payload.barcode.trim() : null,
      payload.notes !== undefined ? payload.notes.trim() : null,
      nowIso,
      id,
    ],
  });

  // Update pack unit / pack size if specified
  if (payload.packSize !== undefined || payload.packUnit !== undefined) {
    const unitCheck = await db.execute({
      sql: `SELECT id, unit_name, qty_in_base_unit FROM item_units WHERE item_id = ? AND is_default_sale = 1`,
      args: [id],
    });
    const currentUnit = unitCheck.rows[0];
    const newUnitName = String(payload.packUnit || currentUnit?.unit_name || 'STRIP').trim().toUpperCase();
    const newPackSize = Number(payload.packSize) > 0 ? Number(payload.packSize) : Number(currentUnit?.qty_in_base_unit || 1);

    if (currentUnit) {
      await db.execute({
        sql: `UPDATE item_units SET unit_name = ?, qty_in_base_unit = ? WHERE id = ?`,
        args: [newUnitName, newPackSize, currentUnit.id],
      });
    } else {
      await db.execute({
        sql: `INSERT INTO item_units (id, item_id, unit_name, qty_in_base_unit, is_default_sale, is_default_purchase)
              VALUES (?, ?, ?, ?, 1, 1)`,
        args: [`u_${id}_01`, id, newUnitName, newPackSize],
      });
    }
  }

  return { success: true, id };
}

// ----------------------------------------------------------------------------
// BATCH MANAGEMENT SERVICES
// ----------------------------------------------------------------------------
export interface CreateOrRestockBatchPayload {
  itemId: string;
  batchNo: string;
  expiryDate: string;
  mrpPaise?: number;
  mrp?: number;
  ptrPaise?: number;
  ptr?: number;
  quantity?: number;
  movementType?: 'opening' | 'adjustment';
  notes?: string;
}

export async function createOrRestockBatch(payload: CreateOrRestockBatchPayload) {
  const db = await ensureDbReady();
  if (!payload.itemId) throw new Error('Item ID is required.');
  const cleanBatchNo = (payload.batchNo || '').trim().toUpperCase();
  if (!cleanBatchNo) throw new Error('Batch number is required.');

  const parsedExp = parseExpiryInput(payload.expiryDate);
  if (!parsedExp.valid || !parsedExp.isoExpiryDate) {
    throw new Error(parsedExp.error || 'Invalid expiry date format.');
  }
  const isoExpiry = parsedExp.isoExpiryDate;

  const mrpPaise = payload.mrpPaise ?? (payload.mrp !== undefined ? rupeesToPaise(payload.mrp) : 0);
  const ptrPaise = payload.ptrPaise ?? (payload.ptr !== undefined ? rupeesToPaise(payload.ptr) : 0);
  const qty = Number(payload.quantity) || 0;
  const nowIso = new Date().toISOString();

  // Check if batch already exists for this item with matching batch_no and mrp
  const batchRes = await db.execute({
    sql: `SELECT id, mrp_paise, ptr_paise, expiry_date FROM batches WHERE item_id = ? AND UPPER(batch_no) = ? AND mrp_paise = ?`,
    args: [payload.itemId, cleanBatchNo, mrpPaise],
  });

  let batchId = batchRes.rows[0]?.id ? String(batchRes.rows[0].id) : '';

  if (!batchId) {
    batchId = `bat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.execute({
      sql: `INSERT INTO batches (
        id, item_id, batch_no, expiry_date, mrp_paise, ptr_paise, pts_paise, purchase_rate_paise, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [batchId, payload.itemId, cleanBatchNo, isoExpiry, mrpPaise, ptrPaise, ptrPaise, ptrPaise, nowIso],
    });
  } else {
    // Refresh expiry and ptr on existing batch
    await db.execute({
      sql: `UPDATE batches SET expiry_date = ?, ptr_paise = ? WHERE id = ?`,
      args: [isoExpiry, ptrPaise || Number(batchRes.rows[0].ptr_paise), batchId],
    });
  }

  // Record stock movement if quantity was supplied
  if (qty > 0) {
    const smId = `sm_bat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const moveType = payload.movementType || 'opening';
    await db.execute({
      sql: `INSERT INTO stock_movements (
        id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        smId,
        payload.itemId,
        batchId,
        qty,
        moveType,
        moveType === 'opening' ? 'opening' : 'STOCK_ADJUSTMENT',
        `BATCH-${cleanBatchNo}`,
        nowIso,
        'user_pharmacist',
      ],
    });
  }

  return { success: true, batchId, quantityAdded: qty };
}

export interface UpdateBatchDetailsPayload {
  batchNo?: string;
  expiryDate?: string;
  mrpPaise?: number;
  mrp?: number;
  ptrPaise?: number;
  ptr?: number;
  currentStock?: number;
  reason?: string;
}

export async function updateBatchDetails(batchId: string, payload: UpdateBatchDetailsPayload) {
  const db = await ensureDbReady();
  const bRes = await db.execute({
    sql: `SELECT b.*, COALESCE(v.current_qty_base, 0) as current_qty_base
          FROM batches b
          LEFT JOIN v_batch_stock v ON v.batch_id = b.id
          WHERE b.id = ?`,
    args: [batchId],
  });
  const b = bRes.rows[0];
  if (!b) throw new Error(`Batch ${batchId} not found.`);

  const nowIso = new Date().toISOString();
  let diff = 0;

  // Direct physical stock quantity correction
  if (payload.currentStock !== undefined) {
    const currentQty = Number(b.current_qty_base || 0);
    const targetQty = Number(payload.currentStock);
    diff = targetQty - currentQty;

    if (diff !== 0) {
      const smId = `sm_adj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db.execute({
        sql: `INSERT INTO stock_movements (
          id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at, user_id
        ) VALUES (?, ?, ?, ?, 'adjustment', 'STOCK_ADJUSTMENT', ?, ?, ?)`,
        args: [
          smId,
          b.item_id,
          batchId,
          diff,
          payload.reason || 'DIRECT_PHYSICAL_COUNT_AUDIT',
          nowIso,
          'user_pharmacist',
        ],
      });
    }
  }

  // Update batch metadata
  const cleanBatchNo = payload.batchNo ? payload.batchNo.trim().toUpperCase() : String(b.batch_no);
  let isoExpiry = String(b.expiry_date);
  if (payload.expiryDate) {
    const parsed = parseExpiryInput(payload.expiryDate);
    if (parsed.valid && parsed.isoExpiryDate) {
      isoExpiry = parsed.isoExpiryDate;
    }
  }
  const mrpPaise = payload.mrpPaise ?? (payload.mrp !== undefined ? rupeesToPaise(payload.mrp) : Number(b.mrp_paise));
  const ptrPaise = payload.ptrPaise ?? (payload.ptr !== undefined ? rupeesToPaise(payload.ptr) : Number(b.ptr_paise));

  await db.execute({
    sql: `UPDATE batches SET batch_no = ?, expiry_date = ?, mrp_paise = ?, ptr_paise = ? WHERE id = ?`,
    args: [cleanBatchNo, isoExpiry, mrpPaise, ptrPaise, batchId],
  });

  return { success: true, batchId, stockDifference: diff };
}

// ----------------------------------------------------------------------------
// SHORTBOOK / ORDER DIARY SERVICES
// ----------------------------------------------------------------------------
export async function getShortbookItems() {
  const db = await ensureDbReady();

  // 1. Existing entries in shortbook table
  const sbRes = await db.execute(`
    SELECT
      s.id, s.item_id, s.custom_item_name, s.distributor_id, s.requested_qty,
      s.priority, s.notes, s.status, s.created_at, s.updated_at,
      i.name as item_name, i.generic_name, i.base_unit, i.rack_location,
      i.reorder_level, i.reorder_qty,
      m.name as manufacturer_name,
      p.name as distributor_name, p.phone as distributor_phone,
      u.unit_name as sale_unit, u.qty_in_base_unit as pack_size,
      COALESCE(v.current_stock_base, 0) as current_stock_base
    FROM shortbook s
    LEFT JOIN items i ON i.id = s.item_id
    LEFT JOIN manufacturers m ON m.id = i.manufacturer_id
    LEFT JOIN parties p ON p.id = s.distributor_id
    LEFT JOIN item_units u ON u.item_id = s.item_id AND u.is_default_sale = 1
    LEFT JOIN (
      SELECT item_id, SUM(current_qty_base) as current_stock_base
      FROM v_batch_stock GROUP BY item_id
    ) v ON v.item_id = s.item_id
    ORDER BY s.created_at DESC
  `);

  // 2. Auto low stock & out of stock items from catalog (current_stock_base <= reorder_level)
  const lowStockRes = await db.execute(`
    SELECT
      i.id as item_id,
      i.name as item_name,
      i.generic_name,
      i.base_unit,
      i.rack_location,
      i.reorder_level,
      i.reorder_qty,
      m.name as manufacturer_name,
      u.unit_name as sale_unit,
      COALESCE(u.qty_in_base_unit, 1) as pack_size,
      COALESCE(SUM(v.current_qty_base), 0) as current_stock_base
    FROM items i
    LEFT JOIN v_batch_stock v ON v.item_id = i.id
    LEFT JOIN manufacturers m ON m.id = i.manufacturer_id
    LEFT JOIN item_units u ON u.item_id = i.id AND u.is_default_sale = 1
    WHERE i.is_active = 1
    GROUP BY i.id
    HAVING current_stock_base <= i.reorder_level
    ORDER BY current_stock_base ASC, i.name ASC
  `);

  // Active distributors list for dropdown
  const distRes = await db.execute(`
    SELECT id, name, phone, gstin FROM parties
    WHERE type IN ('supplier', 'both') AND is_active = 1
    ORDER BY name ASC
  `);

  const pendingItemIds = new Set(
    sbRes.rows.filter((r) => r.status === 'pending' || r.status === 'ordered').map((r) => String(r.item_id))
  );

  const lowStockItems = lowStockRes.rows.map((r) => {
    const curStock = Number(r.current_stock_base || 0);
    const reorder = Number(r.reorder_level || 20);
    const reorderQty = Number(r.reorder_qty || 100);
    const suggested = Math.max(reorderQty - curStock, 10);
    const isPending = pendingItemIds.has(String(r.item_id));

    return {
      itemId: String(r.item_id),
      itemName: String(r.item_name),
      genericName: String(r.generic_name || ''),
      manufacturer: String(r.manufacturer_name || 'General'),
      rackLocation: String(r.rack_location || '—'),
      currentStock: curStock,
      reorderLevel: reorder,
      suggestedQty: suggested,
      baseUnit: String(r.base_unit),
      saleUnit: String(r.sale_unit || r.base_unit),
      packSize: Number(r.pack_size || 1),
      isAlreadyInShortbook: isPending,
      priority: curStock === 0 ? ('urgent' as const) : ('normal' as const),
    };
  });

  return {
    shortbookItems: sbRes.rows,
    lowStockItems,
    distributors: distRes.rows,
  };
}

export interface AddToShortbookPayload {
  itemId?: string;
  customItemName?: string;
  distributorId?: string;
  requestedQty: number;
  priority?: 'low' | 'normal' | 'urgent';
  notes?: string;
}

export async function addToShortbook(payload: AddToShortbookPayload) {
  const db = await ensureDbReady();
  const cleanCustom = (payload.customItemName || '').trim();
  const itemId = payload.itemId?.trim() || null;

  if (!itemId && !cleanCustom) {
    throw new Error('Please specify either an existing medicine or a custom item name.');
  }

  const nowIso = new Date().toISOString();
  const id = `sb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const requestedQty = Math.max(1, Number(payload.requestedQty) || 1);
  const priority = payload.priority || 'normal';

  await db.execute({
    sql: `INSERT INTO shortbook (
      id, item_id, custom_item_name, distributor_id, requested_qty,
      priority, notes, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    args: [
      id,
      itemId,
      cleanCustom,
      payload.distributorId?.trim() || null,
      requestedQty,
      priority,
      payload.notes?.trim() || '',
      nowIso,
      nowIso,
    ],
  });

  return { success: true, id };
}

export async function updateShortbookStatus(id: string, status: 'pending' | 'ordered' | 'received' | 'cancelled', notes?: string) {
  const db = await ensureDbReady();
  const nowIso = new Date().toISOString();

  // If this was an auto item from low stock list
  if (id.startsWith('auto_')) {
    const itemId = id.replace('auto_', '');
    const itemRes = await db.execute({ sql: `SELECT name, reorder_qty FROM items WHERE id = ?`, args: [itemId] });
    const item = itemRes.rows[0];
    const newId = `sb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    await db.execute({
      sql: `INSERT INTO shortbook (
        id, item_id, custom_item_name, distributor_id, requested_qty,
        priority, notes, status, created_at, updated_at
      ) VALUES (?, ?, '', NULL, ?, 'normal', ?, ?, ?, ?)`,
      args: [
        newId,
        itemId,
        Number(item?.reorder_qty || 10),
        notes || 'Auto reorder item',
        status,
        nowIso,
        nowIso,
      ],
    });
    return { success: true, id: newId, status };
  }

  await db.execute({
    sql: `UPDATE shortbook SET status = ?, updated_at = ? ${notes !== undefined ? ', notes = ?' : ''} WHERE id = ?`,
    args: notes !== undefined ? [status, nowIso, notes, id] : [status, nowIso, id],
  });

  return { success: true, id, status };
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

  const batchesRes = await db.execute(`
    SELECT
      v.batch_id, v.item_id, v.batch_no, v.expiry_date, v.mrp_paise,
      v.ptr_paise, v.purchase_rate_paise, v.current_qty_base,
      i.name as item_name, i.gst_rate_bp
    FROM v_batch_stock v
    JOIN items i ON i.id = v.item_id
    WHERE v.current_qty_base > 0
    ORDER BY v.expiry_date ASC, i.name ASC
  `);

  return {
    suppliers: suppliersRes.rows,
    items: itemsWithUnits,
    recentPurchases: recentPurchasesRes.rows,
    availableBatches: batchesRes.rows,
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

// ----------------------------------------------------------------------------
// 9. CUSTOMER KHATA (UDHAR LEDGER) & CASH CLOSING & PURCHASE RETURNS
// ----------------------------------------------------------------------------

export interface KhataCustomerSummary {
  id: string;
  name: string;
  phone: string;
  address: string;
  creditLimitPaise: number;
  openingBalancePaise: number;
  openingBalanceType: string;
  totalDebitPaise: number;
  totalCreditPaise: number;
  balancePaise: number;
  nature: 'dr' | 'cr';
  unpaidBillsCount: number;
  oldestDueDays: number;
  status: 'clear' | 'active' | 'overdue' | 'limit_exceeded';
}

export async function getPartyLedger(partyId: string) {
  const db = await ensureDbReady();
  const entriesRes = await db.execute({
    sql: `SELECT * FROM ledger_entries WHERE party_id = ? ORDER BY date ASC, id ASC`,
    args: [partyId],
  });
  return entriesRes.rows;
}

export async function getCustomerKhataLedger(customerId?: string) {
  const db = await ensureDbReady();
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayMs = new Date(todayIso + 'T00:00:00Z').getTime();
  const msInDay = 24 * 60 * 60 * 1000;

  // 1. Fetch customer parties
  const partiesRes = await db.execute(`
    SELECT id, name, phone, address, credit_limit_paise, opening_balance_paise, opening_balance_type, notes
    FROM parties
    WHERE type IN ('customer', 'both') AND is_active = 1
    ORDER BY name ASC
  `);

  // 2. Fetch ledger totals per party
  const ledgerSumRes = await db.execute(`
    SELECT party_id, SUM(debit_paise) as total_debit, SUM(credit_paise) as total_credit
    FROM ledger_entries
    GROUP BY party_id
  `);
  const ledgerMap = new Map<string, { debit: number; credit: number }>();
  for (const r of ledgerSumRes.rows) {
    ledgerMap.set(String(r.party_id), {
      debit: Number(r.total_debit || 0),
      credit: Number(r.total_credit || 0),
    });
  }

  // 3. Unpaid credit invoices per customer
  const duesRes = await db.execute(`
    SELECT customer_id, invoice_date, total_paise, paid_paise
    FROM sales_invoices
    WHERE status = 'posted' AND payment_mode = 'credit' AND total_paise > paid_paise
  `);
  const duesMap = new Map<string, { count: number; maxDaysOld: number }>();
  for (const r of duesRes.rows) {
    const cId = String(r.customer_id);
    const invMs = new Date(String(r.invoice_date) + 'T00:00:00Z').getTime();
    const daysOld = Math.max(0, Math.floor((todayMs - invMs) / msInDay));
    const curr = duesMap.get(cId) || { count: 0, maxDaysOld: 0 };
    curr.count += 1;
    if (daysOld > curr.maxDaysOld) curr.maxDaysOld = daysOld;
    duesMap.set(cId, curr);
  }

  const customers: KhataCustomerSummary[] = partiesRes.rows.map((p) => {
    const id = String(p.id);
    const led = ledgerMap.get(id) || { debit: 0, credit: 0 };
    const opBal = p.opening_balance_type === 'cr'
      ? -Number(p.opening_balance_paise || 0)
      : Number(p.opening_balance_paise || 0);
    const net = opBal + led.debit - led.credit;
    const dueInfo = duesMap.get(id) || { count: 0, maxDaysOld: 0 };
    const creditLimit = Number(p.credit_limit_paise || 0);

    let status: 'clear' | 'active' | 'overdue' | 'limit_exceeded' = 'active';
    if (net <= 0) {
      status = 'clear';
    } else if (creditLimit > 0 && net > creditLimit) {
      status = 'limit_exceeded';
    } else if (dueInfo.maxDaysOld > 30) {
      status = 'overdue';
    }

    return {
      id,
      name: String(p.name),
      phone: String(p.phone || ''),
      address: String(p.address || ''),
      creditLimitPaise: creditLimit,
      openingBalancePaise: Number(p.opening_balance_paise || 0),
      openingBalanceType: String(p.opening_balance_type || 'dr'),
      totalDebitPaise: led.debit,
      totalCreditPaise: led.credit,
      balancePaise: Math.abs(net),
      nature: net >= 0 ? 'dr' : 'cr',
      unpaidBillsCount: dueInfo.count,
      oldestDueDays: dueInfo.maxDaysOld,
      status,
    };
  });

  // Selected customer
  const targetId = customerId || (customers.find((c) => c.balancePaise > 0 && c.nature === 'dr')?.id || customers[0]?.id || '');
  let selectedCustomer: any = null;
  let invoices: any[] = [];
  let receipts: any[] = [];
  let ledgerEntries: any[] = [];

  if (targetId) {
    selectedCustomer = customers.find((c) => c.id === targetId) || null;

    const invRes = await db.execute({
      sql: `SELECT id, invoice_no, invoice_date, total_paise, paid_paise, payment_mode, status, notes
            FROM sales_invoices
            WHERE customer_id = ? AND status = 'posted'
            ORDER BY invoice_date DESC, id DESC`,
      args: [targetId],
    });
    invoices = invRes.rows.map((r) => ({
      id: String(r.id),
      invoiceNo: String(r.invoice_no),
      invoiceDate: String(r.invoice_date),
      totalPaise: Number(r.total_paise),
      paidPaise: Number(r.paid_paise),
      duePaise: Math.max(0, Number(r.total_paise) - Number(r.paid_paise)),
      paymentMode: String(r.payment_mode),
      status: String(r.status),
      notes: String(r.notes || ''),
    }));

    const rctRes = await db.execute({
      sql: `SELECT id, date, amount_paise, mode, reference, notes, against_invoice_ids_json
            FROM receipts
            WHERE party_id = ?
            ORDER BY date DESC, id DESC`,
      args: [targetId],
    });
    receipts = rctRes.rows.map((r) => {
      let againstInvoices: string[] = [];
      try {
        againstInvoices = JSON.parse(String(r.against_invoice_ids_json || '[]'));
      } catch {}
      return {
        id: String(r.id),
        date: String(r.date),
        amountPaise: Number(r.amount_paise),
        mode: String(r.mode),
        reference: String(r.reference || ''),
        notes: String(r.notes || ''),
        againstInvoices,
      };
    });

    const ledRes = await db.execute({
      sql: `SELECT id, date, doc_type, doc_id, debit_paise, credit_paise, narration
            FROM ledger_entries
            WHERE party_id = ?
            ORDER BY date ASC, id ASC`,
      args: [targetId],
    });

    let running = selectedCustomer?.openingBalanceType === 'cr'
      ? -selectedCustomer.openingBalancePaise
      : (selectedCustomer?.openingBalancePaise || 0);

    ledgerEntries = ledRes.rows.map((r) => {
      const dr = Number(r.debit_paise || 0);
      const cr = Number(r.credit_paise || 0);
      running = running + dr - cr;
      return {
        id: String(r.id),
        date: String(r.date),
        docType: String(r.doc_type),
        docId: String(r.doc_id),
        debitPaise: dr,
        creditPaise: cr,
        narration: String(r.narration || ''),
        runningBalancePaise: Math.abs(running),
        nature: running >= 0 ? 'dr' : 'cr',
      };
    });
  }

  const totalOutstandingPaise = customers
    .filter((c) => c.nature === 'dr')
    .reduce((s, c) => s + c.balancePaise, 0);

  const totalOverduePaise = customers
    .filter((c) => c.nature === 'dr' && c.oldestDueDays > 30)
    .reduce((s, c) => s + c.balancePaise, 0);

  return {
    customers,
    selectedCustomer,
    invoices,
    receipts,
    ledgerEntries,
    summary: {
      totalCustomers: customers.length,
      customersWithDue: customers.filter((c) => c.balancePaise > 0 && c.nature === 'dr').length,
      totalOutstandingPaise,
      totalOverduePaise,
    },
  };
}

export async function recordCustomerPayment(payload: {
  customerId: string;
  amountPaise: number;
  mode: 'cash' | 'upi' | 'bank';
  reference?: string;
  notes?: string;
}) {
  const db = await ensureDbReady();
  const amt = Math.round(Number(payload.amountPaise));
  if (amt <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const custRes = await db.execute({
    sql: `SELECT id, name, phone, opening_balance_paise, opening_balance_type FROM parties WHERE id = ? AND is_active = 1`,
    args: [payload.customerId],
  });
  if (custRes.rows.length === 0) {
    throw new Error(`Customer with ID '${payload.customerId}' not found.`);
  }
  const cust = custRes.rows[0];

  const todayIso = new Date().toISOString().slice(0, 10);
  const fyYear = todayIso.slice(2, 4);
  const countRes = await db.execute(`SELECT COUNT(*) as cnt FROM receipts`);
  const seq = Number(countRes.rows[0]?.cnt || 0) + 1;
  const receiptNo = `RCT-${fyYear}${String(seq).padStart(4, '0')}`;
  const receiptId = `rct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Apply payment against open credit invoices FIFO
  let remainingToApply = amt;
  const appliedInvoiceIds: string[] = [];
  const openInvoicesRes = await db.execute({
    sql: `SELECT id, total_paise, paid_paise FROM sales_invoices
          WHERE customer_id = ? AND status = 'posted' AND total_paise > paid_paise
          ORDER BY invoice_date ASC, id ASC`,
    args: [payload.customerId],
  });
  for (const inv of openInvoicesRes.rows) {
    if (remainingToApply <= 0) break;
    const due = Number(inv.total_paise) - Number(inv.paid_paise);
    const apply = Math.min(due, remainingToApply);
    await db.execute({
      sql: `UPDATE sales_invoices SET paid_paise = paid_paise + ? WHERE id = ?`,
      args: [apply, inv.id],
    });
    remainingToApply -= apply;
    appliedInvoiceIds.push(String(inv.id));
  }

  // Insert into receipts
  await db.execute({
    sql: `INSERT INTO receipts (
      id, party_id, date, amount_paise, mode, reference, against_invoice_ids_json, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      receiptId,
      payload.customerId,
      todayIso,
      amt,
      payload.mode,
      payload.reference || receiptNo,
      JSON.stringify(appliedInvoiceIds),
      payload.notes || '',
    ],
  });

  // Insert into ledger_entries (credit customer balance)
  const modeLabel = payload.mode.toUpperCase();
  const narration = `Payment received via ${modeLabel}${payload.reference ? ` (Ref: ${payload.reference})` : ''}${payload.notes ? ` - ${payload.notes}` : ''}`;
  await db.execute({
    sql: `INSERT INTO ledger_entries (
      id, party_id, date, doc_type, doc_id, debit_paise, credit_paise, narration
    ) VALUES (?, ?, ?, 'RECEIPT', ?, 0, ?, ?)`,
    args: [
      `le_rct_${Date.now()}`,
      payload.customerId,
      todayIso,
      receiptNo,
      amt,
      narration,
    ],
  });

  // Compute updated balance
  const opBal = cust.opening_balance_type === 'cr'
    ? -Number(cust.opening_balance_paise || 0)
    : Number(cust.opening_balance_paise || 0);
  const ledgerRes = await db.execute({
    sql: `SELECT COALESCE(SUM(debit_paise), 0) as debits, COALESCE(SUM(credit_paise), 0) as credits FROM ledger_entries WHERE party_id = ?`,
    args: [payload.customerId],
  });
  const debits = Number(ledgerRes.rows[0]?.debits || 0);
  const credits = Number(ledgerRes.rows[0]?.credits || 0);
  const netBalance = opBal + debits - credits;

  return {
    receiptId,
    receiptNo,
    customerName: String(cust.name),
    customerPhone: String(cust.phone || ''),
    amountPaise: amt,
    mode: payload.mode,
    date: todayIso,
    updatedBalancePaise: netBalance,
    nature: netBalance >= 0 ? 'dr' : 'cr',
    appliedInvoicesCount: appliedInvoiceIds.length,
  };
}

export async function getDayClosingSummary(dateIso?: string) {
  const db = await ensureDbReady();
  const closingDate = dateIso || new Date().toISOString().slice(0, 10);

  // Sales totals by mode on closingDate
  const cashSalesRes = await db.execute({
    sql: `SELECT COALESCE(SUM(paid_paise), 0) as amt FROM sales_invoices WHERE invoice_date = ? AND payment_mode = 'cash' AND status = 'posted'`,
    args: [closingDate],
  });
  const upiSalesRes = await db.execute({
    sql: `SELECT COALESCE(SUM(paid_paise), 0) as amt FROM sales_invoices WHERE invoice_date = ? AND payment_mode = 'upi' AND status = 'posted'`,
    args: [closingDate],
  });
  const cardSalesRes = await db.execute({
    sql: `SELECT COALESCE(SUM(paid_paise), 0) as amt FROM sales_invoices WHERE invoice_date = ? AND payment_mode = 'card' AND status = 'posted'`,
    args: [closingDate],
  });
  const creditSalesRes = await db.execute({
    sql: `SELECT COALESCE(SUM(total_paise), 0) as amt FROM sales_invoices WHERE invoice_date = ? AND payment_mode = 'credit' AND status = 'posted'`,
    args: [closingDate],
  });
  const billCountRes = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM sales_invoices WHERE invoice_date = ? AND status = 'posted'`,
    args: [closingDate],
  });

  const cashSalesPaise = Number(cashSalesRes.rows[0]?.amt || 0);
  const upiSalesPaise = Number(upiSalesRes.rows[0]?.amt || 0);
  const cardSalesPaise = Number(cardSalesRes.rows[0]?.amt || 0);
  const creditSalesPaise = Number(creditSalesRes.rows[0]?.amt || 0);
  const totalSalesPaise = cashSalesPaise + upiSalesPaise + cardSalesPaise + creditSalesPaise;
  const billCount = Number(billCountRes.rows[0]?.cnt || 0);

  // Khata Receipts on closingDate
  const khataCashRes = await db.execute({
    sql: `SELECT COALESCE(SUM(amount_paise), 0) as amt FROM receipts WHERE date = ? AND mode = 'cash'`,
    args: [closingDate],
  });
  const khataUpiRes = await db.execute({
    sql: `SELECT COALESCE(SUM(amount_paise), 0) as amt FROM receipts WHERE date = ? AND mode = 'upi'`,
    args: [closingDate],
  });
  const khataCashPaise = Number(khataCashRes.rows[0]?.amt || 0);
  const khataUpiPaise = Number(khataUpiRes.rows[0]?.amt || 0);

  // Expenses on closingDate
  const cashExpensesRes = await db.execute({
    sql: `SELECT COALESCE(SUM(amount_paise), 0) as amt FROM expenses WHERE date = ? AND mode = 'cash'`,
    args: [closingDate],
  });
  const totalExpensesRes = await db.execute({
    sql: `SELECT COALESCE(SUM(amount_paise), 0) as amt FROM expenses WHERE date = ?`,
    args: [closingDate],
  });
  const cashExpensesPaise = Number(cashExpensesRes.rows[0]?.amt || 0);
  const totalExpensesPaise = Number(totalExpensesRes.rows[0]?.amt || 0);

  // Cash Purchases outflow on closingDate (if any)
  const cashPurchasesRes = await db.execute({
    sql: `SELECT COALESCE(SUM(paid_paise), 0) as amt FROM purchase_invoices WHERE invoice_date = ? AND payment_mode = 'cash' AND status = 'posted'`,
    args: [closingDate],
  });
  const cashPurchasesPaise = Number(cashPurchasesRes.rows[0]?.amt || 0);

  // Expected Cash in Drawer
  const expectedCashPaise = cashSalesPaise + khataCashPaise - cashExpensesPaise - cashPurchasesPaise;

  // Check if day is already closed in cash_closings
  const existingRes = await db.execute({
    sql: `SELECT * FROM cash_closings WHERE closing_date = ?`,
    args: [closingDate],
  });
  const existingClosing = existingRes.rows.length > 0 ? existingRes.rows[0] : null;

  // Recent 7 day closings
  const historyRes = await db.execute(`
    SELECT * FROM cash_closings ORDER BY closing_date DESC LIMIT 7
  `);

  return {
    closingDate,
    billCount,
    sales: {
      cashSalesPaise,
      upiSalesPaise,
      cardSalesPaise,
      creditSalesPaise,
      totalSalesPaise,
    },
    khataReceipts: {
      cashPaise: khataCashPaise,
      upiPaise: khataUpiPaise,
      totalPaise: khataCashPaise + khataUpiPaise,
    },
    expenses: {
      cashPaise: cashExpensesPaise,
      totalPaise: totalExpensesPaise,
    },
    purchases: {
      cashPaise: cashPurchasesPaise,
    },
    expectedCashPaise,
    isClosed: !!existingClosing,
    existingClosing,
    recentClosings: historyRes.rows,
  };
}

export async function saveDayClosing(payload: {
  closingDate: string;
  cashPhysicalPaise: number;
  notes?: string;
  closedBy?: string;
}) {
  const db = await ensureDbReady();
  const summary = await getDayClosingSummary(payload.closingDate);
  const cashPhysical = Math.round(Number(payload.cashPhysicalPaise));
  const discrepancy = cashPhysical - summary.expectedCashPaise;
  const nowIso = new Date().toISOString();
  const closingTime = nowIso.slice(11, 19);
  const id = `close_${payload.closingDate.replace(/-/g, '')}`;
  let userId: string | null = payload.closedBy || 'user_admin';
  const userCheck = await db.execute({
    sql: `SELECT id FROM users WHERE id = ?`,
    args: [userId],
  });
  if (userCheck.rows.length === 0) {
    const adminCheck = await db.execute({ sql: `SELECT id FROM users WHERE id = 'user_admin'`, args: [] });
    userId = adminCheck.rows.length > 0 ? 'user_admin' : null;
  }

  await db.execute({
    sql: `INSERT INTO cash_closings (
      id, closing_date, closing_time, cash_system_paise, cash_physical_paise,
      cash_discrepancy_paise, upi_system_paise, card_system_paise, credit_system_paise,
      total_sales_paise, notes, closed_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(closing_date) DO UPDATE SET
      closing_time = excluded.closing_time,
      cash_system_paise = excluded.cash_system_paise,
      cash_physical_paise = excluded.cash_physical_paise,
      cash_discrepancy_paise = excluded.cash_discrepancy_paise,
      upi_system_paise = excluded.upi_system_paise,
      card_system_paise = excluded.card_system_paise,
      credit_system_paise = excluded.credit_system_paise,
      total_sales_paise = excluded.total_sales_paise,
      notes = excluded.notes,
      closed_by = excluded.closed_by,
      created_at = excluded.created_at`,
    args: [
      id,
      payload.closingDate,
      closingTime,
      summary.expectedCashPaise,
      cashPhysical,
      discrepancy,
      summary.sales.upiSalesPaise,
      summary.sales.cardSalesPaise,
      summary.sales.creditSalesPaise,
      summary.sales.totalSalesPaise,
      payload.notes || '',
      userId,
      nowIso,
    ],
  });

  return {
    id,
    closingDate: payload.closingDate,
    closingTime,
    cashSystemPaise: summary.expectedCashPaise,
    cashPhysicalPaise: cashPhysical,
    cashDiscrepancyPaise: discrepancy,
    upiSystemPaise: summary.sales.upiSalesPaise,
    cardSystemPaise: summary.sales.cardSalesPaise,
    creditSystemPaise: summary.sales.creditSalesPaise,
    totalSalesPaise: summary.sales.totalSalesPaise,
    notes: payload.notes || '',
    closedBy: userId,
  };
}

export async function processPurchaseReturn(payload: {
  supplierId: string;
  originalInvoiceNo?: string;
  reason: string;
  items: Array<{
    itemId: string;
    batchId: string;
    qtyBase: number;
    ratePaise: number;
  }>;
}) {
  const db = await ensureDbReady();
  if (!payload.items || payload.items.length === 0) {
    throw new Error('At least one item line is required for purchase return.');
  }

  // Verify supplier exists
  const suppRes = await db.execute({
    sql: `SELECT id, name, gstin, state_code, phone FROM parties WHERE id = ?`,
    args: [payload.supplierId],
  });
  if (suppRes.rows.length === 0) {
    throw new Error(`Supplier with ID '${payload.supplierId}' not found.`);
  }
  const supplier = suppRes.rows[0];

  const todayIso = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const currentYear = new Date().getFullYear();

  // Generate return number
  const countRes = await db.execute(`SELECT COUNT(*) as cnt FROM purchase_returns`);
  const seq = Number(countRes.rows[0]?.cnt || 0) + 1;
  const returnNo = `PRN-${currentYear}-${String(seq).padStart(4, '0')}`;
  const returnId = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Find original purchase invoice if reference provided
  let originalPurchaseId: string | null = null;
  if (payload.originalInvoiceNo) {
    const invRes = await db.execute({
      sql: `SELECT id FROM purchase_invoices WHERE id = ? OR supplier_invoice_no = ? OR entry_no = ? LIMIT 1`,
      args: [payload.originalInvoiceNo, payload.originalInvoiceNo, payload.originalInvoiceNo],
    });
    if (invRes.rows.length > 0) {
      originalPurchaseId = String(invRes.rows[0].id);
    }
  }

  // Calculate tax and totals per line
  let subtotalPaise = 0;
  let taxPaise = 0;
  const processedLines: any[] = [];

  for (let idx = 0; idx < payload.items.length; idx++) {
    const line = payload.items[idx];
    const qty = Math.round(Number(line.qtyBase));
    const rate = Math.round(Number(line.ratePaise));
    if (qty <= 0) {
      throw new Error(`Quantity must be > 0 for item index ${idx}`);
    }

    // Fetch item for GST rate and name
    const itemRes = await db.execute({
      sql: `SELECT name, gst_rate_bp FROM items WHERE id = ?`,
      args: [line.itemId],
    });
    const itemName = String(itemRes.rows[0]?.name || 'Unknown Item');
    const gstRateBp = Number(itemRes.rows[0]?.gst_rate_bp || 1200);

    // Fetch batch for batch_no and expiry
    const batchRes = await db.execute({
      sql: `SELECT batch_no, expiry_date FROM batches WHERE id = ?`,
      args: [line.batchId],
    });
    const batchNo = String(batchRes.rows[0]?.batch_no || 'NA');
    const expiryDate = String(batchRes.rows[0]?.expiry_date || '');

    const lineTaxablePaise = qty * rate;
    const lineTaxPaise = Math.round((lineTaxablePaise * gstRateBp) / 10000);
    const lineTotalPaise = lineTaxablePaise + lineTaxPaise;

    subtotalPaise += lineTaxablePaise;
    taxPaise += lineTaxPaise;

    processedLines.push({
      itemId: line.itemId,
      itemName,
      batchId: line.batchId,
      batchNo,
      expiryDate,
      qtyBase: qty,
      ratePaise: rate,
      gstRateBp,
      taxablePaise: lineTaxablePaise,
      taxPaise: lineTaxPaise,
      lineTotalPaise,
    });
  }

  const totalPaise = subtotalPaise + taxPaise;

  // 1. Insert into purchase_returns
  await db.execute({
    sql: `INSERT INTO purchase_returns (
      id, return_no, return_date, supplier_id, original_purchase_id, reason,
      subtotal_paise, tax_paise, total_paise, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user_pharmacist', ?)`,
    args: [
      returnId,
      returnNo,
      todayIso,
      payload.supplierId,
      originalPurchaseId,
      payload.reason || 'Distributor Expiry Return',
      subtotalPaise,
      taxPaise,
      totalPaise,
      nowIso,
    ],
  });

  // 2. Insert items and stock movements
  for (let idx = 0; idx < processedLines.length; idx++) {
    const l = processedLines[idx];
    const priId = `pri_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 5)}`;

    await db.execute({
      sql: `INSERT INTO purchase_return_items (
        id, return_id, item_id, batch_id, qty_base, rate_paise, tax_paise, line_total_paise
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        priId,
        returnId,
        l.itemId,
        l.batchId,
        l.qtyBase,
        l.ratePaise,
        l.taxPaise,
        l.lineTotalPaise,
      ],
    });

    // Deduct inventory: negative signed qty
    await db.execute({
      sql: `INSERT INTO stock_movements (
        id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at
      ) VALUES (?, ?, ?, ?, 'purchase_return', 'PURCHASE_RETURN', ?, ?)`,
      args: [
        `sm_pr_${Date.now()}_${idx}`,
        l.itemId,
        l.batchId,
        -l.qtyBase,
        returnId,
        nowIso,
      ],
    });
  }

  // 3. Ledger entry: debit supplier balance
  const narration = `Distributor Debit Note #${returnNo} - Return: ${payload.reason || 'Expiry / Damage Return'}`;
  await db.execute({
    sql: `INSERT INTO ledger_entries (
      id, party_id, date, doc_type, doc_id, debit_paise, credit_paise, narration
    ) VALUES (?, ?, ?, 'PURCHASE_RETURN', ?, ?, 0, ?)`,
    args: [
      `le_pr_${Date.now()}`,
      payload.supplierId,
      todayIso,
      returnNo,
      totalPaise,
      narration,
    ],
  });

  return {
    returnId,
    returnNo,
    returnDate: todayIso,
    supplierId: payload.supplierId,
    supplierName: String(supplier.name),
    subtotalPaise,
    taxPaise,
    totalPaise,
    lines: processedLines,
  };
}

export async function getPurchaseReturnsList(supplierId?: string) {
  const db = await ensureDbReady();
  const filterSupplier = supplierId ? `WHERE pr.supplier_id = '${supplierId}'` : '';

  const returnsRes = await db.execute(`
    SELECT
      pr.id, pr.return_no, pr.return_date, pr.supplier_id, pr.original_purchase_id,
      pr.reason, pr.subtotal_paise, pr.tax_paise, pr.total_paise, pr.created_at,
      p.name as supplier_name, p.gstin as supplier_gstin, p.phone as supplier_phone,
      (SELECT COUNT(*) FROM purchase_return_items WHERE return_id = pr.id) as item_count
    FROM purchase_returns pr
    JOIN parties p ON p.id = pr.supplier_id
    ${filterSupplier}
    ORDER BY pr.return_date DESC, pr.created_at DESC
  `);

  const returnIds = returnsRes.rows.map((r) => `'${r.id}'`).join(',');
  const itemsMap = new Map<string, any[]>();
  if (returnIds.length > 0) {
    const itemsRes = await db.execute(`
      SELECT pri.*, i.name as item_name, b.batch_no, b.expiry_date
      FROM purchase_return_items pri
      JOIN items i ON i.id = pri.item_id
      JOIN batches b ON b.id = pri.batch_id
      WHERE pri.return_id IN (${returnIds})
    `);
    for (const r of itemsRes.rows) {
      const rid = String(r.return_id);
      const list = itemsMap.get(rid) || [];
      list.push({
        id: String(r.id),
        itemId: String(r.item_id),
        itemName: String(r.item_name),
        batchId: String(r.batch_id),
        batchNo: String(r.batch_no),
        expiryDate: String(r.expiry_date),
        qtyBase: Number(r.qty_base),
        ratePaise: Number(r.rate_paise),
        taxPaise: Number(r.tax_paise),
        lineTotalPaise: Number(r.line_total_paise),
      });
      itemsMap.set(rid, list);
    }
  }

  const returnsWithItems = returnsRes.rows.map((r) => ({
    id: String(r.id),
    returnNo: String(r.return_no),
    returnDate: String(r.return_date),
    supplierId: String(r.supplier_id),
    supplierName: String(r.supplier_name),
    supplierGstin: String(r.supplier_gstin || ''),
    supplierPhone: String(r.supplier_phone || ''),
    originalPurchaseId: r.original_purchase_id ? String(r.original_purchase_id) : null,
    reason: String(r.reason),
    subtotalPaise: Number(r.subtotal_paise),
    taxPaise: Number(r.tax_paise),
    totalPaise: Number(r.total_paise),
    itemCount: Number(r.item_count || 0),
    createdAt: String(r.created_at),
    items: itemsMap.get(String(r.id)) || [],
  }));

  const batchesRes = await db.execute(`
    SELECT
      v.batch_id, v.item_id, v.batch_no, v.expiry_date, v.mrp_paise,
      v.ptr_paise, v.purchase_rate_paise, v.current_qty_base,
      i.name as item_name, i.gst_rate_bp
    FROM v_batch_stock v
    JOIN items i ON i.id = v.item_id
    WHERE v.current_qty_base > 0
    ORDER BY v.expiry_date ASC, i.name ASC
  `);

  return {
    returns: returnsWithItems,
    availableBatches: batchesRes.rows.map((b) => ({
      batchId: String(b.batch_id),
      itemId: String(b.item_id),
      itemName: String(b.item_name),
      batchNo: String(b.batch_no),
      expiryDate: String(b.expiry_date),
      mrpPaise: Number(b.mrp_paise),
      ptrPaise: Number(b.ptr_paise),
      purchaseRatePaise: Number(b.purchase_rate_paise),
      currentQtyBase: Number(b.current_qty_base),
      gstRateBp: Number(b.gst_rate_bp),
    })),
  };
}
