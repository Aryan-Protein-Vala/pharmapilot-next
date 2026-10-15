import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { initDatabase, closeDb, getDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import {
  getCustomerKhataLedger,
  recordCustomerPayment,
  getDayClosingSummary,
  saveDayClosing,
  processPurchaseReturn,
  getPurchaseReturnsList,
  commitSaleInvoice,
  createExpense,
} from '@/lib/db-service';
import { GET as getKhataRoute, POST as postKhataRoute } from '@/app/api/accounts/khata/route';
import { GET as getDayClosingRoute, POST as postDayClosingRoute } from '@/app/api/accounts/day-closing/route';
import { GET as getReturnsRoute, POST as postReturnsRoute } from '@/app/api/purchases/returns/route';
import fs from 'node:fs';

const TEST_DB_FILE = 'pharmapilot_khata_test.db';
let testClient: ReturnType<typeof createClient>;

beforeAll(async () => {
  for (const ext of ['', '-wal', '-shm']) {
    const file = `${TEST_DB_FILE}${ext}`;
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {}
    }
  }

  process.env.TURSO_DATABASE_URL = `file:${TEST_DB_FILE}`;
  testClient = createClient({ url: `file:${TEST_DB_FILE}` });
  await initDatabase(testClient);
  await seedDatabase(testClient);
});

afterAll(async () => {
  await testClient.close();
  await closeDb();

  for (const ext of ['', '-wal', '-shm']) {
    const file = `${TEST_DB_FILE}${ext}`;
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {}
    }
  }
});

describe('1. Customer Khata / Udhar Ledger (Credit Book)', () => {
  it('retrieves customer khata ledger and customer summaries', async () => {
    const khata = await getCustomerKhataLedger();
    expect(khata.customers.length).toBeGreaterThan(0);
    expect(khata.summary).toBeDefined();
    expect(typeof khata.summary.totalOutstandingPaise).toBe('number');

    // Customer Ramesh Kumar from seed
    const ramesh = khata.customers.find((c) => c.name.includes('Ramesh'));
    expect(ramesh).toBeDefined();
    expect(ramesh?.nature).toBe('dr');
  });

  it('records customer credit sale and updates outstanding balance in ledger', async () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    // Create a credit sale for Ramesh
    const saleResult = await commitSaleInvoice({
      customerId: 'party_patient_ramesh',
      paymentMode: 'credit',
      lines: [
        {
          itemId: 'item_dolo_650',
          batchId: 'batch_dolo_01',
          unitMode: 'loose',
          qty: 20,
          discountPct: 0,
        },
      ],
    });

    expect(saleResult.invoiceNo).toBeDefined();
    expect(saleResult.totalPaise).toBeGreaterThan(0);

    const khataAfterSale = await getCustomerKhataLedger('party_patient_ramesh');
    expect(khataAfterSale.selectedCustomer).toBeDefined();
    expect(khataAfterSale.selectedCustomer.balancePaise).toBeGreaterThanOrEqual(saleResult.totalPaise);
    expect(khataAfterSale.invoices.some((inv) => inv.invoiceNo === saleResult.invoiceNo)).toBe(true);

    // Verify ledger running balance
    expect(khataAfterSale.ledgerEntries.length).toBeGreaterThan(0);
    const lastLedger = khataAfterSale.ledgerEntries[khataAfterSale.ledgerEntries.length - 1];
    expect(lastLedger.runningBalancePaise).toBeGreaterThan(0);
  });

  it('records partial customer payment and creates receipt and credit ledger entry', async () => {
    const beforeKhata = await getCustomerKhataLedger('party_patient_ramesh');
    const prevBalance = beforeKhata.selectedCustomer.balancePaise;

    // Sharma ji / Ramesh pays ₹500 via UPI
    const paymentResult = await recordCustomerPayment({
      customerId: 'party_patient_ramesh',
      amountPaise: 50000, // ₹500.00
      mode: 'upi',
      reference: 'UPI98320491',
      notes: 'Partial payment on counter',
    });

    expect(paymentResult.receiptNo).toMatch(/^RCT-\d{4}/);
    expect(paymentResult.amountPaise).toBe(50000);
    expect(paymentResult.updatedBalancePaise).toBe(prevBalance - 50000);

    // Verify in db
    const receiptsCheck = await testClient.execute({
      sql: 'SELECT * FROM receipts WHERE id = ?',
      args: [paymentResult.receiptId],
    });
    expect(receiptsCheck.rows.length).toBe(1);
    expect(Number(receiptsCheck.rows[0].amount_paise)).toBe(50000);
    expect(receiptsCheck.rows[0].mode).toBe('upi');

    // Verify in ledger_entries
    const ledgerCheck = await testClient.execute({
      sql: 'SELECT * FROM ledger_entries WHERE doc_id = ? AND party_id = ?',
      args: [paymentResult.receiptNo, 'party_patient_ramesh'],
    });
    expect(ledgerCheck.rows.length).toBe(1);
    expect(Number(ledgerCheck.rows[0].credit_paise)).toBe(50000);
    expect(Number(ledgerCheck.rows[0].debit_paise)).toBe(0);
    expect(String(ledgerCheck.rows[0].narration)).toContain('UPI');
  });

  it('handles GET and POST on /api/accounts/khata endpoint', async () => {
    // Test GET API
    const reqGet = new Request('http://localhost:3000/api/accounts/khata?customerId=party_patient_ramesh');
    const resGet = await getKhataRoute(reqGet);
    expect(resGet.status).toBe(200);
    const jsonGet = await resGet.json();
    expect(jsonGet.customers).toBeDefined();
    expect(jsonGet.selectedCustomer.id).toBe('party_patient_ramesh');

    // Test POST API
    const reqPost = new Request('http://localhost:3000/api/accounts/khata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerId: 'party_patient_ramesh',
        amountPaise: 20000,
        mode: 'cash',
        notes: 'Cash paid at desk',
      }),
    });
    const resPost = await postKhataRoute(reqPost);
    expect(resPost.status).toBe(200);
    const jsonPost = await resPost.json();
    expect(jsonPost.receiptNo).toBeDefined();
    expect(jsonPost.amountPaise).toBe(20000);
  });
});

describe('2. Daily Counter Cash Closing (Galla Count / Day End Close)', () => {
  it('calculates collections summary: Cash Sales, UPI, Card, Credit, Khata Receipts, Expenses', async () => {
    const todayIso = new Date().toISOString().slice(0, 10);

    // Create a cash sale
    await commitSaleInvoice({
      paymentMode: 'cash',
      lines: [
        {
          itemId: 'item_dolo_650',
          batchId: 'batch_dolo_01',
          unitMode: 'loose',
          qty: 10,
          discountPct: 0,
        },
      ],
    });

    // Create a shop cash expense
    await createExpense({
      date: todayIso,
      category: 'Shop Rent',
      amountPaise: 10000, // ₹100.00
      mode: 'cash',
      notes: 'Cold chain electricity topup',
    });

    const summary = await getDayClosingSummary(todayIso);
    expect(summary.closingDate).toBe(todayIso);
    expect(summary.sales.cashSalesPaise).toBeGreaterThan(0);
    expect(summary.expenses.cashPaise).toBeGreaterThanOrEqual(10000);
    expect(summary.expectedCashPaise).toBe(
      summary.sales.cashSalesPaise +
        summary.khataReceipts.cashPaise -
        summary.expenses.cashPaise -
        summary.purchases.cashPaise
    );
  });

  it('saves day closing and calculates accurate discrepancy (Exact Match, Shortage, Excess)', async () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const summary = await getDayClosingSummary(todayIso);
    const expected = summary.expectedCashPaise;

    // 1. Shortage scenario (e.g. ₹50 short)
    const shortPhysical = expected - 5000;
    const shortageResult = await saveDayClosing({
      closingDate: todayIso,
      cashPhysicalPaise: shortPhysical,
      notes: 'Cash shortage of ₹50 verified',
      closedBy: 'user_admin',
    });

    expect(shortageResult.cashDiscrepancyPaise).toBe(-5000);
    expect(shortageResult.cashPhysicalPaise).toBe(shortPhysical);

    // 2. Exact match scenario
    const exactResult = await saveDayClosing({
      closingDate: todayIso,
      cashPhysicalPaise: expected,
      notes: 'Galla balanced perfectly',
      closedBy: 'user_admin',
    });

    expect(exactResult.cashDiscrepancyPaise).toBe(0);

    // Verify persisted in cash_closings table
    const closeDbRes = await testClient.execute({
      sql: 'SELECT * FROM cash_closings WHERE closing_date = ?',
      args: [todayIso],
    });
    expect(closeDbRes.rows.length).toBe(1);
    expect(Number(closeDbRes.rows[0].cash_physical_paise)).toBe(expected);
    expect(Number(closeDbRes.rows[0].cash_discrepancy_paise)).toBe(0);
  });

  it('handles GET and POST on /api/accounts/day-closing endpoint', async () => {
    const todayIso = new Date().toISOString().slice(0, 10);

    // GET
    const reqGet = new Request(`http://localhost:3000/api/accounts/day-closing?date=${todayIso}`);
    const resGet = await getDayClosingRoute(reqGet);
    expect(resGet.status).toBe(200);
    const jsonGet = await resGet.json();
    expect(jsonGet.expectedCashPaise).toBeDefined();

    // POST
    const reqPost = new Request('http://localhost:3000/api/accounts/day-closing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        closingDate: todayIso,
        cashPhysicalPaise: 50000,
        notes: 'API Day close test',
      }),
    });
    const resPost = await postDayClosingRoute(reqPost);
    expect(resPost.status).toBe(200);
    const jsonPost = await resPost.json();
    expect(jsonPost.closingDate).toBe(todayIso);
    expect(jsonPost.cashPhysicalPaise).toBe(50000);
  });
});

describe('3. Purchase Return / Distributor Expiry Return (Stockist Debit Note)', () => {
  it('processes purchase return: generates PRN no, deducts stock, debits supplier ledger', async () => {
    // Check initial stock for batch_dolo_01
    const initialBatchRes = await testClient.execute("SELECT current_qty_base FROM v_batch_stock WHERE batch_id = 'batch_dolo_01'");
    const initialStock = Number(initialBatchRes.rows[0]?.current_qty_base || 0);

    // Process return of 10 packs to MediRep Pharma Distributors
    const returnResult = await processPurchaseReturn({
      supplierId: 'party_dist_medirep',
      reason: 'Expired Batch Return',
      items: [
        {
          itemId: 'item_dolo_650',
          batchId: 'batch_dolo_01',
          qtyBase: 10,
          ratePaise: 2500, // ₹25.00 PTR
        },
      ],
    });

    expect(returnResult.returnNo).toMatch(/^PRN-\d{4}-\d{4}$/);
    expect(returnResult.totalPaise).toBeGreaterThan(0);
    expect(returnResult.supplierName).toContain('MediRep');

    // 1. Verify row in purchase_returns
    const prRes = await testClient.execute({
      sql: 'SELECT * FROM purchase_returns WHERE id = ?',
      args: [returnResult.returnId],
    });
    expect(prRes.rows.length).toBe(1);
    expect(prRes.rows[0].reason).toBe('Expired Batch Return');

    // 2. Verify stock deduction in stock_movements
    const smRes = await testClient.execute({
      sql: "SELECT * FROM stock_movements WHERE ref_doc_type = 'PURCHASE_RETURN' AND ref_doc_id = ?",
      args: [returnResult.returnId],
    });
    expect(smRes.rows.length).toBe(1);
    expect(Number(smRes.rows[0].qty_base_signed)).toBe(-10);
    expect(smRes.rows[0].movement_type).toBe('purchase_return');

    // Verify stock decreased in v_batch_stock
    const finalBatchRes = await testClient.execute("SELECT current_qty_base FROM v_batch_stock WHERE batch_id = 'batch_dolo_01'");
    const finalStock = Number(finalBatchRes.rows[0]?.current_qty_base || 0);
    expect(finalStock).toBe(initialStock - 10);

    // 3. Verify ledger entry debited to supplier
    const ledgerRes = await testClient.execute({
      sql: "SELECT * FROM ledger_entries WHERE doc_type = 'PURCHASE_RETURN' AND doc_id = ?",
      args: [returnResult.returnNo],
    });
    expect(ledgerRes.rows.length).toBe(1);
    expect(Number(ledgerRes.rows[0].debit_paise)).toBe(returnResult.totalPaise);
    expect(Number(ledgerRes.rows[0].credit_paise)).toBe(0);
  });

  it('lists purchase returns and returns available batches with stock', async () => {
    const listData = await getPurchaseReturnsList();
    expect(listData.returns.length).toBeGreaterThan(0);
    expect(listData.availableBatches.length).toBeGreaterThan(0);

    const firstReturn = listData.returns[0];
    expect(firstReturn.returnNo).toBeDefined();
    expect(firstReturn.items.length).toBeGreaterThan(0);
  });

  it('handles GET and POST on /api/purchases/returns endpoint', async () => {
    // GET
    const reqGet = new Request('http://localhost:3000/api/purchases/returns');
    const resGet = await getReturnsRoute(reqGet);
    expect(resGet.status).toBe(200);
    const jsonGet = await resGet.json();
    expect(jsonGet.returns).toBeDefined();
    expect(jsonGet.availableBatches).toBeDefined();

    // POST
    const reqPost = new Request('http://localhost:3000/api/purchases/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierId: 'party_dist_medirep',
        reason: 'Near Expiry Distributor Return',
        items: [
          {
            itemId: 'item_dolo_650',
            batchId: 'batch_dolo_01',
            qtyBase: 5,
            ratePaise: 2500,
          },
        ],
      }),
    });
    const resPost = await postReturnsRoute(reqPost);
    expect(resPost.status).toBe(200);
    const jsonPost = await resPost.json();
    expect(jsonPost.returnNo).toMatch(/^PRN-/);
  });
});
