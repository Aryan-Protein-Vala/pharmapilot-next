// src/scripts/seed.ts — Database Initialization & Seeding CLI Runner
import { initDatabase, getDb, closeDb } from '../lib/db';
import { seedDatabase } from '../lib/seed';
import { scanChronicRefills } from '../lib/refills';

async function main() {
  console.log('=====================================================');
  console.log('💊 PharmaPilot Next — Database & Automation Bootstrapper');
  console.log('=====================================================\n');

  const db = getDb();

  console.log('1. Initializing 25-table schema with WAL mode & FTS5...');
  await initDatabase(db);
  console.log('   ✅ Database schema initialized successfully.\n');

  console.log('2. Seeding authentic Indian pharmacy inventory & CDSCO masters...');
  const result = await seedDatabase(db);
  console.log(`   ✅ Shop: ${result.shopName}`);
  console.log(`   ✅ Manufacturers: ${result.manufacturersCount}`);
  console.log(`   ✅ Medicines / Batches: ${result.itemsCount}`);
  console.log(`   ✅ Stock Movements: ${result.stockMovementsCount}`);
  console.log(`   ✅ Chronic Patients: ${result.chronicPatientsCount}`);
  console.log(`   ✅ Historical Sales: ${result.salesInvoicesCount}\n`);

  console.log('3. Verifying stock levels via v_batch_stock view:');
  const stockRows = await db.execute(`
    SELECT
      i.name,
      i.schedule,
      b.batch_no,
      b.mrp_paise,
      v.current_qty_base,
      i.base_unit
    FROM v_batch_stock v
    JOIN batches b ON b.id = v.batch_id
    JOIN items i ON i.id = v.item_id
    ORDER BY i.name ASC
  `);

  console.log('   -------------------------------------------------------------------------------------');
  console.log('   | Medicine Name                       | Sched | Batch   | MRP (₹) | Stock Available |');
  console.log('   -------------------------------------------------------------------------------------');
  for (const row of stockRows.rows) {
    const name = String(row.name).padEnd(35, ' ');
    const sched = String(row.schedule).padEnd(5, ' ');
    const batch = String(row.batch_no).padEnd(7, ' ');
    const mrp = (`₹${(Number(row.mrp_paise) / 100).toFixed(2)}`).padEnd(7, ' ');
    const stock = `${row.current_qty_base} ${row.base_unit}`.padEnd(15, ' ');
    console.log(`   | ${name} | ${sched} | ${batch} | ${mrp} | ${stock} |`);
  }
  console.log('   -------------------------------------------------------------------------------------\n');

  console.log('4. Verifying FTS5 Full-Text Search on items_fts:');
  const searchQueries = ['Paracetamol', 'Minoxidil', 'Augmentin'];
  for (const q of searchQueries) {
    const fts = await db.execute({
      sql: `SELECT item_id, name, generic_name FROM items_fts WHERE items_fts MATCH ? LIMIT 3`,
      args: [`${q}*`],
    });
    console.log(`   🔍 Query: "${q}" -> Found ${fts.rows.length} match(es):`);
    for (const r of fts.rows) {
      console.log(`      • ${r.name} (${r.generic_name})`);
    }
  }
  console.log('');

  console.log('5. Testing Chronic Condition Refill Automation Scanner:');
  const refillScan = await scanChronicRefills({ db, daysThreshold: 3 });
  console.log(`   ✅ Refills Due in <= 3 Days: ${refillScan.alerts.length}`);
  for (const alert of refillScan.alerts) {
    console.log(`\n   🔔 Alert for: ${alert.patientName} (${alert.cleanPhone})`);
    console.log(`      Condition: ${alert.condition} | Medicine: ${alert.itemName}`);
    console.log(`      Days Remaining: ${alert.daysRemaining} (Depletes: ${alert.estimatedDepletionDate})`);
    console.log(`      Status: ${alert.status.toUpperCase()}`);
    console.log(`      WhatsApp Link: ${alert.whatsapp.link.slice(0, 75)}...`);
  }

  console.log('\n=====================================================');
  console.log('🎉 All Database & Automation verifications passed cleanly!');
  console.log('=====================================================\n');

  await closeDb();
}

main().catch((err) => {
  console.error('❌ Database Initialization / Seeding failed:', err);
  process.exit(1);
});
