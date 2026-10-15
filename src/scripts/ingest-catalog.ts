// src/scripts/ingest-catalog.ts — Massive Indian Medicine Catalog Ingestion Engine
import { getDb, initDatabase, closeDb } from '../lib/db';
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

interface IngestionOptions {
  filePath?: string;
  limit?: number;
  chunkSize: number;
  generateDemoCount?: number;
}

const COMMON_MANUFACTURERS = [
  'Sun Pharmaceutical Industries Ltd.',
  'Cipla Ltd.',
  "Dr. Reddy's Laboratories Ltd.",
  'Torrent Pharmaceuticals Ltd.',
  'Alkem Laboratories Ltd.',
  'Lupin Ltd.',
  'Zydus Lifesciences Ltd.',
  'Mankind Pharma Ltd.',
  'Intas Pharmaceuticals Ltd.',
  'Abbott Healthcare Pvt. Ltd.',
  'GlaxoSmithKline Pharmaceuticals Ltd.',
  'Sanofi India Ltd.',
  'Pfizer Ltd.',
  'Micro Labs Ltd.',
  'Glenmark Pharmaceuticals Ltd.',
  'Alembic Pharmaceuticals Ltd.',
  'Ipca Laboratories Ltd.',
  'Aristo Pharmaceuticals Pvt. Ltd.',
  'USV Private Limited',
  'Macleods Pharmaceuticals Ltd.',
  'FDC Ltd.',
  'Apex Laboratories Pvt. Ltd.',
  'Blue Cross Laboratories Ltd.',
  'Emcure Pharmaceuticals Ltd.',
  'Hetero Healthcare Ltd.',
];

const COMMON_SALTS = [
  { salt: 'Paracetamol 650mg', cat: 'Analgesic / Antipyretic', sched: 'none', base: 'TAB', pack: 15, mrp: 3360 },
  { salt: 'Paracetamol 500mg', cat: 'Analgesic / Antipyretic', sched: 'none', base: 'TAB', pack: 10, mrp: 2000 },
  { salt: 'Amoxicillin 500mg + Clavulanic Acid 125mg', cat: 'Antibiotic', sched: 'H', base: 'TAB', pack: 10, mrp: 20170 },
  { salt: 'Azithromycin 500mg', cat: 'Antibiotic', sched: 'H', base: 'TAB', pack: 3, mrp: 8040 },
  { salt: 'Azithromycin 250mg', cat: 'Antibiotic', sched: 'H', base: 'TAB', pack: 6, mrp: 7200 },
  { salt: 'Pantoprazole 40mg + Domperidone 30mg', cat: 'Gastrointestinal', sched: 'H', base: 'CAP', pack: 15, mrp: 21750 },
  { salt: 'Rabeprazole 20mg + Domperidone 30mg', cat: 'Gastrointestinal', sched: 'H', base: 'CAP', pack: 10, mrp: 18500 },
  { salt: 'Telmisartan 40mg', cat: 'Antihypertensive', sched: 'H', base: 'TAB', pack: 15, mrp: 24300 },
  { salt: 'Telmisartan 40mg + Amlodipine 5mg', cat: 'Antihypertensive', sched: 'H', base: 'TAB', pack: 15, mrp: 28500 },
  { salt: 'Metformin 500mg (SR)', cat: 'Antidiabetic', sched: 'H', base: 'TAB', pack: 20, mrp: 4800 },
  { salt: 'Metformin 1000mg + Glimepiride 2mg', cat: 'Antidiabetic', sched: 'H', base: 'TAB', pack: 15, mrp: 16500 },
  { salt: 'Atorvastatin 10mg', cat: 'Cardiovascular', sched: 'H', base: 'TAB', pack: 15, mrp: 14200 },
  { salt: 'Rosuvastatin 10mg', cat: 'Cardiovascular', sched: 'H', base: 'TAB', pack: 10, mrp: 19800 },
  { salt: 'Levocetirizine 5mg + Montelukast 10mg', cat: 'Respiratory / Antiallergic', sched: 'H', base: 'TAB', pack: 10, mrp: 16800 },
  { salt: 'Cough Formula (Dextromethorphan + CPM)', cat: 'Cough Syrup', sched: 'none', base: 'BOTTLE', pack: 1, mrp: 11500 },
  { salt: 'Calcium Carbonate 500mg + Vitamin D3', cat: 'Nutritional / Supplement', sched: 'none', base: 'TAB', pack: 15, mrp: 14250 },
  { salt: 'Multivitamin + Multimineral + Zinc', cat: 'Nutritional / Supplement', sched: 'none', base: 'TAB', pack: 15, mrp: 18000 },
  { salt: 'Minoxidil 5% w/v Topical Solution', cat: 'Dermatology', sched: 'none', base: 'BOTTLE', pack: 1, mrp: 89000 },
  { salt: 'Minoxidil 5% w/v + Finasteride 0.1% w/v', cat: 'Dermatology', sched: 'H', base: 'BOTTLE', pack: 1, mrp: 99500 },
  { salt: 'Minoxidil 5mg Oral', cat: 'Dermatology / Vasodilator', sched: 'H', base: 'TAB', pack: 10, mrp: 18500 },
  { salt: 'Alprazolam 0.5mg', cat: 'Anxiolytic / Psychotropic', sched: 'H1', base: 'TAB', pack: 15, mrp: 6300 },
  { salt: 'Tramadol 50mg', cat: 'Opioid Analgesic', sched: 'H1', base: 'CAP', pack: 10, mrp: 12000 },
  { salt: 'Ibuprofen 400mg + Paracetamol 325mg', cat: 'Analgesic', sched: 'none', base: 'TAB', pack: 20, mrp: 3800 },
  { salt: 'Ofloxacin 200mg + Ornidazole 500mg', cat: 'Antibiotic / Antiprotozoal', sched: 'H', base: 'TAB', pack: 10, mrp: 14500 },
  { salt: 'Cefixime 200mg', cat: 'Antibiotic', sched: 'H', base: 'TAB', pack: 10, mrp: 19500 },
];

const BRAND_PREFIXES = [
  'Apex', 'Bio', 'Cura', 'Dol', 'Equi', 'Fit', 'Glyco', 'Heal', 'Insta', 'Jov',
  'Klin', 'Life', 'Max', 'Neo', 'Opti', 'Pan', 'Quick', 'Rex', 'Safe', 'Tera',
  'Ultra', 'Vita', 'Well', 'Xen', 'Zen', 'Aero', 'Bron', 'Cardio', 'Dermo', 'Gastro',
];

export async function runIngestion(options: IngestionOptions) {
  console.log('================================================================');
  console.log('🚀 PharmaPilot Next — High-Throughput Indian Medicine Seeder');
  console.log('================================================================');
  console.log(`Chunk Size : ${options.chunkSize} rows/transaction`);
  if (options.generateDemoCount) {
    console.log(`Mode       : Algorithmic Indian Catalog Generator (${options.generateDemoCount} SKUs)`);
  } else if (options.filePath) {
    console.log(`Mode       : Streaming CSV/JSON File (${options.filePath})`);
  }

  const startTime = Date.now();
  const db = getDb();

  // Ensure DB and base schema exist
  console.log('\n[1/4] Verifying WAL mode & indexes...');
  await initDatabase(db);
  await db.execute('PRAGMA synchronous = NORMAL;');
  await db.execute('PRAGMA temp_store = MEMORY;');
  await db.execute('PRAGMA cache_size = -64000;'); // 64MB cache

  // Cache existing manufacturers to avoid repeated inserts
  console.log('[2/4] Pre-caching master entities...');
  const mfgRes = await db.execute('SELECT id, name FROM manufacturers');
  const mfgMap = new Map<string, string>();
  for (const row of mfgRes.rows) {
    mfgMap.set(String(row.name).toLowerCase().trim(), String(row.id));
  }

  // Pre-seed common manufacturers
  for (const mfgName of COMMON_MANUFACTURERS) {
    const key = mfgName.toLowerCase().trim();
    if (!mfgMap.has(key)) {
      const id = `mfg_${mfgMap.size + 1}`;
      await db.execute({
        sql: 'INSERT OR IGNORE INTO manufacturers (id, name, is_active) VALUES (?, ?, 1)',
        args: [id, mfgName],
      });
      mfgMap.set(key, id);
    }
  }

  const existingItemsRes = await db.execute('SELECT name FROM items');
  const existingItemNames = new Set<string>();
  for (const row of existingItemsRes.rows) {
    existingItemNames.add(String(row.name).toLowerCase().trim());
  }

  console.log(`   Cached ${mfgMap.size} manufacturers & ${existingItemNames.size} existing items.`);

  console.log('\n[3/4] Streaming ingestion & transactional batch injection...');
  let totalInserted = 0;
  let batchBuffer: any[] = [];
  const chunkSize = options.chunkSize || 5000;

  const flushBuffer = async () => {
    if (batchBuffer.length === 0) return;
    const statements = [...batchBuffer];
    batchBuffer = [];
    await db.batch(statements, 'write');
  };

  const addItemToBatch = (item: {
    id: string;
    name: string;
    genericName: string;
    mfgId: string;
    category: string;
    drugForm: string;
    hsnCode: string;
    gstRateBp: number;
    schedule: string;
    baseUnit: string;
    saleUnit: string;
    packSize: number;
    rackLocation: string;
    reorderLevel: number;
    reorderQty: number;
    barcode: string;
    mrpPaise: number;
    ptrPaise: number;
  }) => {
    const nowIso = new Date().toISOString();
    const batchId = `b_${item.id}_01`;
    const expYear = 2027 + (totalInserted % 2);
    const expMonth = String(1 + (totalInserted % 12)).padStart(2, '0');
    const expiryDate = `${expYear}-${expMonth}-28`;
    const batchNo = `B${expYear.toString().slice(-2)}${String.fromCharCode(65 + (totalInserted % 26))}${String(10 + (totalInserted % 90))}`;
    const initialStockBase = 10 * item.packSize * (1 + (totalInserted % 5));

    // 1. Insert Item
    batchBuffer.push({
      sql: `INSERT OR IGNORE INTO items (
        id, name, generic_name, manufacturer_id, category, drug_form,
        hsn_code, gst_rate_bp, schedule, base_unit, rack_location,
        reorder_level, reorder_qty, barcode, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      args: [
        item.id, item.name, item.genericName, item.mfgId, item.category, item.drugForm,
        item.hsnCode, item.gstRateBp, item.schedule, item.baseUnit, item.rackLocation,
        item.reorderLevel, item.reorderQty, item.barcode, nowIso, nowIso,
      ],
    });

    // 2. Insert Item Unit
    batchBuffer.push({
      sql: `INSERT OR IGNORE INTO item_units (
        id, item_id, unit_name, qty_in_base_unit, is_default_sale, is_default_purchase
      ) VALUES (?, ?, ?, ?, 1, 1)`,
      args: [`u_${item.id}`, item.id, item.saleUnit, item.packSize],
    });

    // 3. Insert Initial Batch
    batchBuffer.push({
      sql: `INSERT OR IGNORE INTO batches (
        id, item_id, batch_no, expiry_date, mrp_paise, ptr_paise, pts_paise, purchase_rate_paise, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        batchId, item.id, batchNo, expiryDate, item.mrpPaise, item.ptrPaise,
        Math.round(item.ptrPaise * 0.95), item.ptrPaise, nowIso,
      ],
    });

    // 4. Initial Stock Movement
    batchBuffer.push({
      sql: `INSERT OR IGNORE INTO stock_movements (
        id, item_id, batch_id, qty_base_signed, movement_type, ref_doc_type, ref_doc_id, created_at
      ) VALUES (?, ?, ?, ?, 'opening', 'OPENING_STOCK', 'INIT', ?)`,
      args: [`sm_init_${item.id}`, item.id, batchId, initialStockBase, nowIso],
    });

    totalInserted++;

    if (totalInserted % 10000 === 0) {
      const elapsedSec = Math.max(0.01, (Date.now() - startTime) / 1000);
      const rps = Math.round(totalInserted / elapsedSec);
      console.log(`   [PROGRESS] ${totalInserted.toLocaleString()} SKUs ingested... (${rps.toLocaleString()} items/sec)`);
    }
  };

  if (options.generateDemoCount && options.generateDemoCount > 0) {
    const targetCount = options.generateDemoCount;
    let count = 0;

    for (let i = 0; i < targetCount; i++) {
      const saltObj = COMMON_SALTS[i % COMMON_SALTS.length];
      const mfgName = COMMON_MANUFACTURERS[i % COMMON_MANUFACTURERS.length];
      const mfgId = mfgMap.get(mfgName.toLowerCase().trim()) || 'mfg_1';
      const prefix = BRAND_PREFIXES[(i * 7) % BRAND_PREFIXES.length];
      const saltKeyword = saltObj.salt.split(' ')[0];
      const brandName = `${prefix}-${saltKeyword} ${saltObj.salt.match(/\d+mg|\d+%/)?.[0] || ''} ${saltObj.base === 'TAB' ? 'Tablet' : saltObj.base === 'CAP' ? 'Capsule' : 'Syrup'}`.trim();

      const uniqueKey = brandName.toLowerCase();
      if (existingItemNames.has(uniqueKey)) {
        continue;
      }
      existingItemNames.add(uniqueKey);

      const rackRow = String.fromCharCode(65 + (i % 8)); // RACK-A through RACK-H
      const rackNum = 1 + (i % 6);
      const rackLocation = `RACK-${rackRow}${rackNum}`;
      const barcode = `890${String(1000000000 + i)}`;
      const mrp = saltObj.mrp + ((i % 15) * 50);
      const ptr = Math.round(mrp * 0.71); // standard Indian retail 29% margin

      addItemToBatch({
        id: `med_${count + 1}_${Date.now().toString(36)}`,
        name: brandName,
        genericName: saltObj.salt,
        mfgId,
        category: saltObj.cat,
        drugForm: saltObj.base === 'TAB' ? 'Tablet' : saltObj.base === 'CAP' ? 'Capsule' : 'Solution',
        hsnCode: '3004',
        gstRateBp: 1200,
        schedule: saltObj.sched,
        baseUnit: saltObj.base,
        saleUnit: saltObj.base === 'TAB' ? 'STRIP' : saltObj.base === 'CAP' ? 'STRIP' : 'BOTTLE',
        packSize: saltObj.pack,
        rackLocation,
        reorderLevel: 20,
        reorderQty: 100,
        barcode,
        mrpPaise: mrp,
        ptrPaise: ptr,
      });

      count++;

      if (batchBuffer.length >= chunkSize * 4) {
        await flushBuffer();
      }

      if (options.limit && count >= options.limit) break;
    }

    await flushBuffer();
  } else if (options.filePath) {
    const fileStream = fs.createReadStream(options.filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let isHeader = true;
    let headerIndices: Record<string, number> = {};

    for await (const line of rl) {
      if (!line.trim()) continue;

      if (isHeader) {
        const headers = line.split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));
        headers.forEach((h, idx) => { headerIndices[h] = idx; });
        isHeader = false;
        continue;
      }

      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      const name = cols[headerIndices['name'] ?? headerIndices['brand_name'] ?? 0] || 'Unknown Medicine';
      const genericName = cols[headerIndices['generic_name'] ?? headerIndices['composition'] ?? headerIndices['salt'] ?? 1] || '';
      const mfgName = cols[headerIndices['manufacturer'] ?? headerIndices['mfg'] ?? 2] || 'General Pharmaceuticals';
      const mrpRaw = parseFloat(cols[headerIndices['mrp'] ?? headerIndices['price'] ?? 3] || '50');
      const mrpPaise = Math.round(mrpRaw * 100);
      const ptrPaise = Math.round(mrpPaise * 0.71);

      const mfgKey = mfgName.toLowerCase().trim();
      let mfgId = mfgMap.get(mfgKey);
      if (!mfgId) {
        mfgId = `mfg_${mfgMap.size + 1}`;
        batchBuffer.push({
          sql: 'INSERT OR IGNORE INTO manufacturers (id, name, is_active) VALUES (?, ?, 1)',
          args: [mfgId, mfgName],
        });
        mfgMap.set(mfgKey, mfgId);
      }

      const uniqueKey = name.toLowerCase();
      if (existingItemNames.has(uniqueKey)) continue;
      existingItemNames.add(uniqueKey);

      addItemToBatch({
        id: `med_${totalInserted + 1}_${Date.now().toString(36)}`,
        name,
        genericName,
        mfgId,
        category: 'Medicine',
        drugForm: name.toLowerCase().includes('cap') ? 'Capsule' : name.toLowerCase().includes('syr') ? 'Syrup' : 'Tablet',
        hsnCode: '3004',
        gstRateBp: 1200,
        schedule: name.toLowerCase().includes('alprax') || name.toLowerCase().includes('tramadol') ? 'H1' : 'none',
        baseUnit: 'TAB',
        saleUnit: 'STRIP',
        packSize: 10,
        rackLocation: 'RACK-A1',
        reorderLevel: 20,
        reorderQty: 100,
        barcode: '',
        mrpPaise,
        ptrPaise,
      });

      if (batchBuffer.length >= chunkSize * 4) {
        await flushBuffer();
      }

      if (options.limit && totalInserted >= options.limit) break;
    }

    await flushBuffer();
  }

  console.log('\n[4/4] Verifying catalog counts & FTS search index...');
  const countRes = await db.execute('SELECT COUNT(*) as cnt FROM items');
  const batchCountRes = await db.execute('SELECT COUNT(*) as cnt FROM batches');
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('================================================================');
  console.log(`🎉 Ingestion Complete in ${durationSec}s!`);
  console.log(`   Total Items in DB   : ${Number(countRes.rows[0]?.cnt || 0).toLocaleString()} SKUs`);
  console.log(`   Total Batches in DB : ${Number(batchCountRes.rows[0]?.cnt || 0).toLocaleString()} Batches`);
  console.log('================================================================\n');

  await closeDb();
}

// CLI execution helper
if (require.main === module) {
  const args = process.argv.slice(2);
  let demoCount: number | undefined = undefined;
  let filePath: string | undefined = undefined;
  let limit: number | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--demo-scale' && args[i + 1]) {
      demoCount = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      filePath = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Default to 1,000 realistic medicines if run without args
  runIngestion({
    chunkSize: 2000,
    generateDemoCount: demoCount !== undefined ? demoCount : (filePath ? undefined : 2000),
    filePath,
    limit,
  }).catch((err) => {
    console.error('Ingestion failed:', err);
    process.exit(1);
  });
}
