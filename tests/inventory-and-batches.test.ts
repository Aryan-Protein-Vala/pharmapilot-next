// tests/inventory-and-batches.test.ts — Comprehensive Vitest Suite for Inventory, Batches, and Shortbook
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { initDatabase, closeDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import {
  createMedicineMaster,
  updateMedicineMaster,
  createOrRestockBatch,
  updateBatchDetails,
  getShortbookItems,
  addToShortbook,
  updateShortbookStatus,
  getInventoryStock,
} from '@/lib/db-service';
import { POST as itemsPost, PUT as itemsPut } from '@/app/api/inventory/items/route';
import { POST as batchesPost, PUT as batchesPut } from '@/app/api/inventory/batches/route';
import { GET as shortbookGet, POST as shortbookPost, PATCH as shortbookPatch } from '@/app/api/inventory/shortbook/route';
import fs from 'node:fs';

const TEST_DB_FILE = 'inventory_test.db';
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

describe('1. Medicine Master Formulations (+ Add Medicine & Edit)', () => {
  let createdItemId = '';

  it('creates a new medicine master formulation with auto manufacturer and pack unit', async () => {
    const res = await createMedicineMaster({
      name: 'Azithral 500mg Tablet',
      genericName: 'Azithromycin 500mg',
      manufacturerName: 'Alembic Pharmaceuticals Ltd.',
      hsnCode: '3004',
      schedule: 'H',
      baseUnit: 'TAB',
      packSize: 5,
      packUnit: 'STRIP',
      rackLocation: 'RACK-E1',
      reorderLevel: 25,
      reorderQty: 100,
      barcode: '8901234567890',
    });

    expect(res.success).toBe(true);
    expect(res.id).toMatch(/^med_/);
    createdItemId = res.id;

    // Verify item in items table
    const itemRes = await testClient.execute({
      sql: 'SELECT * FROM items WHERE id = ?',
      args: [createdItemId],
    });
    expect(itemRes.rows.length).toBe(1);
    expect(itemRes.rows[0].name).toBe('Azithral 500mg Tablet');
    expect(itemRes.rows[0].generic_name).toBe('Azithromycin 500mg');
    expect(itemRes.rows[0].rack_location).toBe('RACK-E1');
    expect(Number(itemRes.rows[0].reorder_level)).toBe(25);

    // Verify item_units
    const unitRes = await testClient.execute({
      sql: 'SELECT * FROM item_units WHERE item_id = ?',
      args: [createdItemId],
    });
    expect(unitRes.rows.length).toBe(1);
    expect(unitRes.rows[0].unit_name).toBe('STRIP');
    expect(Number(unitRes.rows[0].qty_in_base_unit)).toBe(5);

    // Verify FTS5 search indexing
    const ftsRes = await testClient.execute({
      sql: 'SELECT rowid, item_id, name, generic_name FROM items_fts WHERE items_fts MATCH ?',
      args: ['Azithral*'],
    });
    expect(ftsRes.rows.length).toBeGreaterThan(0);
  });

  it('auto-inserts a brand new manufacturer if not currently in manufacturers table', async () => {
    const brandNewMfg = 'Apex Biotech Pharma Innovations';
    const res = await createMedicineMaster({
      name: 'Apex-Z 10mg Capsule',
      genericName: 'Zinc Sulfate 10mg',
      manufacturerName: brandNewMfg,
      baseUnit: 'CAP',
      packSize: 10,
    });

    expect(res.success).toBe(true);

    const mfgRes = await testClient.execute({
      sql: 'SELECT * FROM manufacturers WHERE name = ?',
      args: [brandNewMfg],
    });
    expect(mfgRes.rows.length).toBe(1);
    expect(mfgRes.rows[0].name).toBe(brandNewMfg);
  });

  it('updates an existing medicine master formulation details', async () => {
    const updateRes = await updateMedicineMaster(createdItemId, {
      name: 'Azithral 500mg Film-Coated Tablet',
      rackLocation: 'RACK-E2',
      hsnCode: '30049099',
      reorderLevel: 30,
      reorderQty: 120,
      packSize: 6,
    });

    expect(updateRes.success).toBe(true);

    const checkRes = await testClient.execute({
      sql: 'SELECT name, rack_location, hsn_code, reorder_level, reorder_qty FROM items WHERE id = ?',
      args: [createdItemId],
    });
    expect(checkRes.rows[0].name).toBe('Azithral 500mg Film-Coated Tablet');
    expect(checkRes.rows[0].rack_location).toBe('RACK-E2');
    expect(checkRes.rows[0].hsn_code).toBe('30049099');
    expect(Number(checkRes.rows[0].reorder_level)).toBe(30);

    const checkUnitRes = await testClient.execute({
      sql: 'SELECT qty_in_base_unit FROM item_units WHERE item_id = ?',
      args: [createdItemId],
    });
    expect(Number(checkUnitRes.rows[0].qty_in_base_unit)).toBe(6);
  });
});

describe('2. Multi-Batch FEFO & Restocking (+ Add Batch, Edit Batch & Direct Stock Audit)', () => {
  let testItemId = '';
  let testBatchId = '';

  beforeAll(async () => {
    const item = await createMedicineMaster({
      name: 'Montair-LC Tablet',
      genericName: 'Montelukast 10mg + Levocetirizine 5mg',
      baseUnit: 'TAB',
      packSize: 10,
      rackLocation: 'RACK-A3',
    });
    testItemId = item.id;
  });

  it('adds a new batch and creates opening stock movement with integer paise', async () => {
    const res = await createOrRestockBatch({
      itemId: testItemId,
      batchNo: 'MLC25A01',
      expiryDate: '12/27',
      mrp: 180.5, // ₹180.50 -> 18050 paise
      ptr: 128.75, // ₹128.75 -> 12875 paise
      quantity: 100, // 100 tabs
      movementType: 'opening',
    });

    expect(res.success).toBe(true);
    expect(res.batchId).toBeDefined();
    testBatchId = res.batchId;

    // Verify batch in batches table
    const batchRow = await testClient.execute({
      sql: 'SELECT * FROM batches WHERE id = ?',
      args: [testBatchId],
    });
    expect(batchRow.rows.length).toBe(1);
    expect(batchRow.rows[0].batch_no).toBe('MLC25A01');
    expect(batchRow.rows[0].expiry_date).toBe('2027-12-31'); // normalized to month end
    expect(Number(batchRow.rows[0].mrp_paise)).toBe(18050);
    expect(Number(batchRow.rows[0].ptr_paise)).toBe(12875);

    // Verify stock movement
    const moveRow = await testClient.execute({
      sql: 'SELECT * FROM stock_movements WHERE batch_id = ?',
      args: [testBatchId],
    });
    expect(moveRow.rows.length).toBe(1);
    expect(Number(moveRow.rows[0].qty_base_signed)).toBe(100);
    expect(moveRow.rows[0].movement_type).toBe('opening');

    // Verify stock in v_batch_stock view
    const viewRow = await testClient.execute({
      sql: 'SELECT current_qty_base FROM v_batch_stock WHERE batch_id = ?',
      args: [testBatchId],
    });
    expect(Number(viewRow.rows[0].current_qty_base)).toBe(100);
  });

  it('restocks an existing batch by reusing batch row and logging adjustment movement', async () => {
    const restockRes = await createOrRestockBatch({
      itemId: testItemId,
      batchNo: 'MLC25A01',
      expiryDate: '2027-12-31',
      mrp: 180.5,
      quantity: 50,
      movementType: 'adjustment',
    });

    expect(restockRes.success).toBe(true);
    expect(restockRes.batchId).toBe(testBatchId);

    const viewRow = await testClient.execute({
      sql: 'SELECT current_qty_base FROM v_batch_stock WHERE batch_id = ?',
      args: [testBatchId],
    });
    expect(Number(viewRow.rows[0].current_qty_base)).toBe(150); // 100 + 50
  });

  it('performs direct physical stock audit correction and calculates movement variance', async () => {
    // Current stock is 150. Chemist counts 142 on physical shelf (-8 discrepancy)
    const editRes = await updateBatchDetails(testBatchId, {
      currentStock: 142,
      reason: 'Physical shelf count audit correction',
    });

    expect(editRes.success).toBe(true);
    expect(editRes.stockDifference).toBe(-8);

    const viewRow = await testClient.execute({
      sql: 'SELECT current_qty_base FROM v_batch_stock WHERE batch_id = ?',
      args: [testBatchId],
    });
    expect(Number(viewRow.rows[0].current_qty_base)).toBe(142);

    // Verify immutable adjustment movement record
    const latestMove = await testClient.execute({
      sql: 'SELECT qty_base_signed, movement_type, ref_doc_type FROM stock_movements WHERE batch_id = ? ORDER BY created_at DESC LIMIT 1',
      args: [testBatchId],
    });
    expect(Number(latestMove.rows[0].qty_base_signed)).toBe(-8);
    expect(latestMove.rows[0].movement_type).toBe('adjustment');
  });

  it('updates batch metadata like batch_no, expiry_date, MRP, and PTR', async () => {
    const editRes = await updateBatchDetails(testBatchId, {
      batchNo: 'MLC25A01-REV',
      expiryDate: '01/29',
      mrp: 195.0,
      ptr: 135.0,
    });

    expect(editRes.success).toBe(true);

    const batchRow = await testClient.execute({
      sql: 'SELECT batch_no, expiry_date, mrp_paise, ptr_paise FROM batches WHERE id = ?',
      args: [testBatchId],
    });
    expect(batchRow.rows[0].batch_no).toBe('MLC25A01-REV');
    expect(batchRow.rows[0].expiry_date).toBe('2029-01-31');
    expect(Number(batchRow.rows[0].mrp_paise)).toBe(19500);
    expect(Number(batchRow.rows[0].ptr_paise)).toBe(13500);
  });
});

describe('3. Shortbook (Order Diary) Management', () => {
  let createdShortbookId = '';

  it('queries shortbook items and detects low-stock items from catalog', async () => {
    const data = await getShortbookItems();
    expect(data.shortbookItems).toBeDefined();
    expect(data.lowStockItems).toBeDefined();
    expect(data.distributors).toBeDefined();
    expect(Array.isArray(data.distributors)).toBe(true);
  });

  it('adds a manual customer demand item to shortbook', async () => {
    const res = await addToShortbook({
      customItemName: 'Scalpe Pro Anti-Dandruff Shampoo 100ml',
      requestedQty: 6,
      priority: 'urgent',
      notes: 'Customer Rohit Gupta waiting (Order #902)',
    });

    expect(res.success).toBe(true);
    expect(res.id).toMatch(/^sb_/);
    createdShortbookId = res.id;

    const row = await testClient.execute({
      sql: 'SELECT * FROM shortbook WHERE id = ?',
      args: [createdShortbookId],
    });
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].custom_item_name).toBe('Scalpe Pro Anti-Dandruff Shampoo 100ml');
    expect(row.rows[0].priority).toBe('urgent');
    expect(row.rows[0].status).toBe('pending');
  });

  it('updates shortbook item status through lifecycle (pending -> ordered -> received)', async () => {
    // 1. Mark as ordered
    const orderedRes = await updateShortbookStatus(createdShortbookId, 'ordered', 'PO placed with Vardhman Agencies');
    expect(orderedRes.success).toBe(true);
    expect(orderedRes.status).toBe('ordered');

    let check = await testClient.execute({ sql: 'SELECT status FROM shortbook WHERE id = ?', args: [createdShortbookId] });
    expect(check.rows[0].status).toBe('ordered');

    // 2. Mark as received
    const receivedRes = await updateShortbookStatus(createdShortbookId, 'received');
    expect(receivedRes.success).toBe(true);
    expect(receivedRes.status).toBe('received');

    check = await testClient.execute({ sql: 'SELECT status FROM shortbook WHERE id = ?', args: [createdShortbookId] });
    expect(check.rows[0].status).toBe('received');
  });
});

describe('4. Inventory REST API Endpoints', () => {
  let createdMedId = '';
  let createdBatchId = '';
  let createdSbId = '';

  it('POST /api/inventory/items creates formulation and returns 201', async () => {
    const req = new Request('http://localhost:3000/api/inventory/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Thyronorm 50mcg Tablet',
        genericName: 'Thyroxine Sodium 50mcg',
        manufacturerName: 'Abbott Healthcare Pvt. Ltd.',
        hsnCode: '3004',
        schedule: 'H',
        baseUnit: 'TAB',
        packSize: 120,
        packUnit: 'BOTTLE',
        rackLocation: 'RACK-D1',
      }),
    });

    const res = await itemsPost(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.id).toBeDefined();
    createdMedId = data.id;
  });

  it('PUT /api/inventory/items updates formulation and returns 200', async () => {
    const req = new Request('http://localhost:3000/api/inventory/items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: createdMedId,
        rackLocation: 'RACK-D2',
        reorderLevel: 15,
      }),
    });

    const res = await itemsPut(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('POST /api/inventory/batches adds batch and returns 201', async () => {
    const req = new Request('http://localhost:3000/api/inventory/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: createdMedId,
        batchNo: 'THY26A05',
        expiryDate: '10/28',
        mrp: 195.0,
        ptr: 140.0,
        quantity: 120,
      }),
    });

    const res = await batchesPost(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.batchId).toBeDefined();
    createdBatchId = data.batchId;
  });

  it('PUT /api/inventory/batches updates batch and returns 200', async () => {
    const req = new Request('http://localhost:3000/api/inventory/batches', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: createdBatchId,
        mrp: 205.0,
        ptr: 145.0,
        currentStock: 118, // 2 tabs discrepancy
      }),
    });

    const res = await batchesPut(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it('GET, POST, PATCH /api/inventory/shortbook lifecycle', async () => {
    // 1. POST
    const postReq = new Request('http://localhost:3000/api/inventory/shortbook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: createdMedId,
        requestedQty: 25,
        priority: 'urgent',
        notes: 'Low stock order trigger',
      }),
    });
    const postRes = await shortbookPost(postReq);
    expect(postRes.status).toBe(201);
    const postData = await postRes.json();
    expect(postData.success).toBe(true);
    createdSbId = postData.id;

    // 2. GET
    const getRes = await shortbookGet();
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.shortbookItems.length).toBeGreaterThan(0);

    // 3. PATCH
    const patchReq = new Request('http://localhost:3000/api/inventory/shortbook', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: createdSbId,
        status: 'ordered',
      }),
    });
    const patchRes = await shortbookPatch(patchReq);
    expect(patchRes.status).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData.success).toBe(true);
  });
});
