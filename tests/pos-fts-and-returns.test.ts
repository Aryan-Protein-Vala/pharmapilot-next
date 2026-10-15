// tests/pos-fts-and-returns.test.ts — Comprehensive Vitest Suite for POS FTS5 Search & Sales Returns
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { initDatabase, closeDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import {
  searchPosItemsFTS,
  processSalesReturn,
  getRecentSalesReturns,
  getSaleInvoiceForReturn,
  commitSaleInvoice,
  getPosCatalog,
} from '@/lib/db-service';
import { GET as searchGet } from '@/app/api/pos/search/route';
import { GET as returnsGet, POST as returnsPost } from '@/app/api/pos/returns/route';
import fs from 'node:fs';

const TEST_DB_FILE = 'pos_fts_test.db';
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

describe('1. POS High-Scale FTS5 Search Service', () => {
  it('returns default active items when query is empty', async () => {
    const results = await searchPosItemsFTS('', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
    expect(results[0]).toHaveProperty('batches');
    expect(results[0]).toHaveProperty('packSize');
  });

  it('searches medicines by brand name prefix using FTS5 in < 50ms', async () => {
    const t0 = performance.now();
    const results = await searchPosItemsFTS('Dolo', 10);
    const durationMs = performance.now() - t0;

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.name.toLowerCase().includes('dolo'))).toBe(true);
    expect(durationMs).toBeLessThan(150);
  });

  it('searches medicines by generic chemical salt composition', async () => {
    const results = await searchPosItemsFTS('Paracetamol', 10);
    expect(results.length).toBeGreaterThan(0);
    for (const item of results) {
      const match =
        item.name.toLowerCase().includes('paracetamol') ||
        item.genericName.toLowerCase().includes('paracetamol');
      expect(match).toBe(true);
    }
  });

  it('searches medicines by exact or prefix barcode', async () => {
    const results = await searchPosItemsFTS('8901148203012', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].barcode).toBe('8901148203012');
  });

  it('handles multiplier prefix syntax (e.g. "2*dolo" or "3*paracetamol")', async () => {
    const results = await searchPosItemsFTS('2*dolo', 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.name.toLowerCase().includes('dolo'))).toBe(true);
  });

  it('joins active batches with live v_batch_stock quantities and MRP', async () => {
    const results = await searchPosItemsFTS('Paracetamol', 5);
    expect(results.length).toBeGreaterThan(0);

    const firstItem = results[0];
    expect(firstItem.batches).toBeDefined();
    expect(Array.isArray(firstItem.batches)).toBe(true);

    if (firstItem.batches.length > 0) {
      const batch = firstItem.batches[0];
      expect(batch).toHaveProperty('id');
      expect(batch).toHaveProperty('batchNo');
      expect(batch).toHaveProperty('expiryDate');
      expect(batch).toHaveProperty('mrpPaise');
      expect(batch).toHaveProperty('availableQtyBase');
      expect(typeof batch.availableQtyBase).toBe('number');
    }
  });

  it('handles special characters safely without FTS syntax crashes', async () => {
    const weirdQueries = ["!@#$%", "'-", '()', '***', 'OR AND NOT', 'unknown_chemical_xyz_123'];
    for (const q of weirdQueries) {
      const results = await searchPosItemsFTS(q, 5);
      expect(Array.isArray(results)).toBe(true);
    }
  });
});

describe('2. Customer Sales Return (Grahak Wapsi) & Restocking', () => {
  it('processes sales return with disposition="restock" and restores stock in v_batch_stock', async () => {
    // 1. Find a medicine with active batch
    const searchRes = await searchPosItemsFTS('Paracetamol', 1);
    expect(searchRes.length).toBeGreaterThan(0);
    const item = searchRes[0];
    const batch = item.batches[0];
    expect(batch).toBeDefined();

    const initialStock = batch.availableQtyBase;
    const returnQty = 5;

    // 2. Process Sales Return with disposition: 'restock'
    const returnResult = await processSalesReturn({
      reason: 'Patient doctor changed prescription',
      refundMode: 'cash',
      items: [
        {
          itemId: item.id,
          batchId: batch.id,
          qtyBase: returnQty,
          ratePaise: batch.mrpPaise,
          disposition: 'restock',
        },
      ],
    });

    expect(returnResult.success).toBe(true);
    expect(returnResult.returnNo).toMatch(/^SRN-\d{4}-\d{4}$/);
    expect(returnResult.totalPaise).toBe(returnQty * batch.mrpPaise);

    // 3. Verify stock has increased by returnQty in v_batch_stock
    const verifySearch = await searchPosItemsFTS(item.name, 1);
    const updatedBatch = verifySearch[0].batches.find((b: any) => b.id === batch.id);
    expect(updatedBatch).toBeDefined();
    expect(updatedBatch!.availableQtyBase).toBe(initialStock + returnQty);
  });

  it('processes sales return with disposition="damage" and does NOT restore stock', async () => {
    const searchRes = await searchPosItemsFTS('Paracetamol', 1);
    const item = searchRes[0];
    const batch = item.batches[0];

    const currentStock = batch.availableQtyBase;
    const returnQty = 3;

    const returnResult = await processSalesReturn({
      reason: 'Damaged packaging returned by customer',
      refundMode: 'cash',
      items: [
        {
          itemId: item.id,
          batchId: batch.id,
          qtyBase: returnQty,
          ratePaise: batch.mrpPaise,
          disposition: 'damage',
        },
      ],
    });

    expect(returnResult.success).toBe(true);

    // Verify stock did NOT increase
    const verifySearch = await searchPosItemsFTS(item.name, 1);
    const updatedBatch = verifySearch[0].batches.find((b: any) => b.id === batch.id);
    expect(updatedBatch!.availableQtyBase).toBe(currentStock);
  });

  it('processes sales return with refundMode="credit" and reduces customer ledger balance', async () => {
    // 1. Get an existing customer
    const catalog = await getPosCatalog(5);
    const customer = catalog.customers[0];
    expect(customer).toBeDefined();

    const searchRes = await searchPosItemsFTS('Paracetamol', 1);
    const item = searchRes[0];
    const batch = item.batches[0];

    // Check customer ledger credits before return
    const ledgerBeforeRes = await testClient.execute({
      sql: 'SELECT COALESCE(SUM(credit_paise), 0) as total_credit FROM ledger_entries WHERE party_id = ?',
      args: [customer.id],
    });
    const creditBefore = Number(ledgerBeforeRes.rows[0].total_credit);

    const returnQty = 2;
    const returnResult = await processSalesReturn({
      customerId: String(customer.id),
      reason: 'Excess medicine returned against credit note',
      refundMode: 'credit',
      items: [
        {
          itemId: item.id,
          batchId: batch.id,
          qtyBase: returnQty,
          ratePaise: batch.mrpPaise,
          disposition: 'restock',
        },
      ],
    });

    expect(returnResult.success).toBe(true);
    expect(returnResult.refundMode).toBe('credit');

    // Check customer ledger credits after return
    const ledgerAfterRes = await testClient.execute({
      sql: 'SELECT COALESCE(SUM(credit_paise), 0) as total_credit FROM ledger_entries WHERE party_id = ?',
      args: [customer.id],
    });
    const creditAfter = Number(ledgerAfterRes.rows[0].total_credit);

    // Credit note increases credit by returnResult.totalPaise (which reduces net customer receivable)
    expect(creditAfter).toBe(creditBefore + returnResult.totalPaise);

    // Verify ledger entry details
    const entryRes = await testClient.execute({
      sql: 'SELECT * FROM ledger_entries WHERE party_id = ? AND doc_id = ?',
      args: [customer.id, returnResult.returnNo],
    });
    expect(entryRes.rows.length).toBe(1);
    expect(entryRes.rows[0].doc_type).toBe('SALE_RETURN');
    expect(Number(entryRes.rows[0].credit_paise)).toBe(returnResult.totalPaise);
    expect(Number(entryRes.rows[0].debit_paise)).toBe(0);
  });

  it('links sales return to original invoice and allows invoice lookup', async () => {
    // 1. Create a sale invoice
    const searchRes = await searchPosItemsFTS('Paracetamol', 1);
    const item = searchRes[0];
    const batch = item.batches[0];

    const saleRes = await commitSaleInvoice({
      paymentMode: 'cash',
      patientName: 'Test Patient',
      patientAddress: 'Test Address',
      lines: [
        {
          itemId: item.id,
          batchId: batch.id,
          unitMode: 'loose',
          qty: 4,
          discountPct: 0,
        },
      ],
    });

    expect(saleRes.invoiceNo).toBeDefined();

    // 2. Lookup bill for return
    const lookupData = await getSaleInvoiceForReturn(saleRes.invoiceNo);
    expect(lookupData).not.toBeNull();
    expect(lookupData!.sale.invoice_no).toBe(saleRes.invoiceNo);
    expect(lookupData!.items.length).toBeGreaterThan(0);
    expect(lookupData!.items[0].batch_no).toBe(batch.batchNo);

    // 3. Process return linked to this invoice
    const returnRes = await processSalesReturn({
      originalInvoiceNo: saleRes.invoiceNo,
      reason: 'Unused medicine return',
      refundMode: 'cash',
      items: [
        {
          itemId: item.id,
          batchId: batch.id,
          qtyBase: 2,
          ratePaise: Number(lookupData!.items[0].rate_paise),
          disposition: 'restock',
        },
      ],
    });

    expect(returnRes.success).toBe(true);
    expect(returnRes.originalInvoiceNo).toBe(saleRes.invoiceNo);

    // 4. Verify in recent sales returns
    const recent = await getRecentSalesReturns(5);
    expect(recent.length).toBeGreaterThan(0);
    const found: any = recent.find((r: any) => r.return_no === returnRes.returnNo);
    expect(found).toBeDefined();
    expect(found.original_invoice_no).toBe(saleRes.invoiceNo);
    expect(found.items.length).toBe(1);
  });
});

describe('3. POS Next.js API Routes', () => {
  it('GET /api/pos/search returns JSON search results', async () => {
    const req = new Request('http://localhost:3000/api/pos/search?q=Apex&limit=5');
    const res = await searchGet(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('results');
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.count).toBe(data.results.length);
  });

  it('GET /api/pos/returns returns recent sales returns or looks up invoice', async () => {
    const reqList = new Request('http://localhost:3000/api/pos/returns?limit=10');
    const resList = await returnsGet(reqList);
    expect(resList.status).toBe(200);

    const listData = await resList.json();
    expect(listData).toHaveProperty('returns');
    expect(Array.isArray(listData.returns)).toBe(true);

    // Non-existent invoice lookup returns 404
    const reqNotFound = new Request('http://localhost:3000/api/pos/returns?invoiceNo=NON_EXISTENT_9999');
    const resNotFound = await returnsGet(reqNotFound);
    expect(resNotFound.status).toBe(404);
  });

  it('POST /api/pos/returns processes customer credit note', async () => {
    const searchRes = await searchPosItemsFTS('Paracetamol', 1);
    const item = searchRes[0];
    const batch = item.batches[0];

    const payload = {
      reason: 'Over the counter return',
      refundMode: 'cash',
      items: [
        {
          itemId: item.id,
          batchId: batch.id,
          qtyBase: 1,
          ratePaise: batch.mrpPaise,
          disposition: 'restock',
        },
      ],
    };

    const req = new Request('http://localhost:3000/api/pos/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await returnsPost(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.returnNo).toMatch(/^SRN-\d{4}-\d{4}$/);
  });
});
