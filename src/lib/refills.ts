// src/lib/refills.ts — Automated Chronic Condition Refill Scanner & WhatsApp Click-to-Chat Generator
import { getDb } from './db';
import type { Client } from '@libsql/client';

export type ChronicCondition = 'Diabetes' | 'Hypertension' | 'Cardiac' | 'Asthma';

export interface RefillAlert {
  saleId: string;
  invoiceNo: string;
  customerId: string | null;
  patientName: string;
  patientPhone: string;
  cleanPhone: string;
  condition: ChronicCondition;
  itemId: string;
  itemName: string;
  genericName: string;
  qtyPurchased: number;
  lastPurchaseDate: string;
  estimatedDepletionDate: string;
  daysRemaining: number;
  status: 'critical' | 'due_soon' | 'overdue';
  whatsapp: {
    link: string;
    message: string;
  };
}

export interface RefillScanResult {
  success: boolean;
  timestamp: string;
  pharmacy: {
    name: string;
    phone: string;
    gstin: string;
  };
  summary: {
    totalScannedSales: number;
    chronicMatchesFound: number;
    refillsDueCount: number;
    conditionsBreakdown: Record<ChronicCondition, number>;
  };
  alerts: RefillAlert[];
}

/**
 * Detects if a medicine belongs to a chronic therapeutic category
 */
export function detectChronicCondition(itemName: string, genericName: string = ''): ChronicCondition | null {
  const text = `${itemName} ${genericName}`.toLowerCase();

  // Diabetes medications
  if (/metformin|glimepiride|vildagliptin|sitagliptin|dapagliflozin|empagliflozin|teneligliptin|glycomet|insulin|pioglitazone|glipizide/i.test(text)) {
    return 'Diabetes';
  }

  // Hypertension / BP medications
  if (/telmisartan|amlodipine|losartan|olmesartan|atenolol|metoprolol|ramipril|cilnidipine|telma|enalapril|propranolol/i.test(text)) {
    return 'Hypertension';
  }

  // Cardiac / Cholesterol / Anti-platelet medications
  if (/atorvastatin|rosuvastatin|clopidogrel|ecosprin|digoxin|nitroglycerin|sorbitrate|warfarin|diltiazem/i.test(text)) {
    return 'Cardiac';
  }

  // Chronic Asthma / COPD maintenance
  if (/budesonide|formoterol|montelukast|salbutamol|levosalbutamol|tiotropium|deriphyllin|beclomethasone/i.test(text)) {
    return 'Asthma';
  }

  return null;
}

/**
 * Normalizes Indian phone number to WhatsApp international standard (e.g. 919876543210)
 */
export function formatWhatsAppPhone(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `91${digits.slice(1)}`;
  }
  return digits;
}

/**
 * Generates personalized WhatsApp refill reminder message and click-to-chat URL
 */
export function generateWhatsAppRefillMessage(params: {
  patientName: string;
  cleanPhone: string;
  shopName: string;
  shopPhone: string;
  itemName: string;
  condition: ChronicCondition;
  qtyPurchased: number;
  daysRemaining: number;
  depletionDateStr: string;
}): { message: string; link: string } {
  const {
    patientName,
    cleanPhone,
    shopName,
    shopPhone,
    itemName,
    condition,
    qtyPurchased,
    daysRemaining,
    depletionDateStr,
  } = params;

  let urgencyStr = '';
  if (daysRemaining < 0) {
    urgencyStr = `was exhausted ${Math.abs(daysRemaining)} day(s) ago`;
  } else if (daysRemaining === 0) {
    urgencyStr = 'runs out today';
  } else if (daysRemaining === 1) {
    urgencyStr = 'runs out tomorrow';
  } else {
    urgencyStr = `runs out in ${daysRemaining} days (on ${depletionDateStr})`;
  }

  const message = [
    `Namaste ${patientName || 'Valued Customer'} ji 🙏`,
    '',
    `This is a health refill reminder from *${shopName}*.`,
    '',
    `Your chronic prescription for *${condition}*:`,
    `💊 *${itemName}*`,
    `⚠️ ${urgencyStr}.`,
    '',
    `To ensure uninterrupted care, would you like us to prepare your monthly refill for doorstep delivery or store pickup?`,
    '',
    `👉 Reply *YES* to confirm, or call us at ${shopPhone}.`,
    'Wishing you continued good health!',
  ].join('\n');

  const link = cleanPhone
    ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`
    : '';

  return { message, link };
}

/**
 * Scans all posted sales invoices, extracts chronic medicine prescriptions,
 * computes remaining days of supply, and returns refill alerts for patients
 * whose supply depletes in <= daysThreshold (default 3 days).
 */
export async function scanChronicRefills(options?: {
  db?: Client;
  daysThreshold?: number;
  asOfDate?: Date | string;
}): Promise<RefillScanResult> {
  const dbClient = options?.db || getDb();
  const daysThreshold = options?.daysThreshold ?? 3;
  const asOf = options?.asOfDate ? new Date(options.asOfDate) : new Date();
  const asOfMs = asOf.getTime();

  // Fetch shop profile
  let shopName = 'PharmaPilot Wellness Pharmacy';
  let shopPhone = '+91 98765 43210';
  let shopGstin = '29AABCU9603R1ZM';

  try {
    const shopRes = await dbClient.execute('SELECT name, phone, gstin FROM shop_profile WHERE id = 1');
    if (shopRes.rows.length > 0) {
      const row = shopRes.rows[0];
      if (row.name) shopName = String(row.name);
      if (row.phone) shopPhone = String(row.phone);
      if (row.gstin) shopGstin = String(row.gstin);
    }
  } catch {
    // If shop_profile not initialized, use defaults
  }

  // Fetch all posted sales items with item, batch and party details
  const salesQuery = `
    SELECT
      si.id AS sale_id,
      si.invoice_no,
      si.invoice_date,
      si.customer_id,
      si.patient_name,
      si.patient_address,
      p.name AS party_name,
      p.phone AS party_phone,
      item.id AS item_id,
      item.name AS item_name,
      item.generic_name,
      item.category,
      sitem.qty_base,
      sitem.mrp_paise,
      b.batch_no,
      b.expiry_date
    FROM sales_items sitem
    JOIN sales_invoices si ON si.id = sitem.sale_id
    JOIN items item ON item.id = sitem.item_id
    JOIN batches b ON b.id = sitem.batch_id
    LEFT JOIN parties p ON p.id = si.customer_id
    WHERE si.status = 'posted'
    ORDER BY si.invoice_date DESC
  `;

  const salesRes = await dbClient.execute(salesQuery);

  const conditionsBreakdown: Record<ChronicCondition, number> = {
    Diabetes: 0,
    Hypertension: 0,
    Cardiac: 0,
    Asthma: 0,
  };

  // Group latest sales by patient + item to avoid alerting on already-refilled items
  // Key: patientKey:itemId
  const latestSalesByPatientItem = new Map<string, { row: any; condition: ChronicCondition }>();
  let chronicMatchesFound = 0;

  for (const row of salesRes.rows) {
    const itemName = String(row.item_name || '');
    const genericName = String(row.generic_name || '');
    const condition = detectChronicCondition(itemName, genericName);
    if (!condition) continue;

    chronicMatchesFound++;
    const patientKey = (String(row.customer_id || '') || String(row.patient_name || '')).trim().toLowerCase();
    const itemId = String(row.item_id);
    const key = `${patientKey}::${itemId}`;

    if (!latestSalesByPatientItem.has(key)) {
      latestSalesByPatientItem.set(key, { row, condition });
    }
  }

  const alerts: RefillAlert[] = [];
  const msInDay = 24 * 60 * 60 * 1000;

  for (const { row, condition } of Array.from(latestSalesByPatientItem.values())) {
    const invoiceDateStr = String(row.invoice_date).slice(0, 10);
    const invoiceDate = new Date(invoiceDateStr + 'T00:00:00Z');
    const qtyBase = Number(row.qty_base) || 1;

    // Standard chronic maintenance assumption: 1 tablet/dose per day
    const supplyDays = Math.max(1, qtyBase);
    const depletionDate = new Date(invoiceDate.getTime() + supplyDays * msInDay);
    const depletionDateStr = depletionDate.toISOString().slice(0, 10);

    // Calculate days remaining
    const diffMs = depletionDate.getTime() - asOfMs;
    const daysRemaining = Math.floor(diffMs / msInDay);

    // Check if within depletion threshold (e.g. <= 3 days, and not older than 7 days overdue)
    if (daysRemaining <= daysThreshold && daysRemaining >= -7) {
      conditionsBreakdown[condition]++;

      let status: 'critical' | 'due_soon' | 'overdue' = 'due_soon';
      if (daysRemaining < 0) {
        status = 'overdue';
      } else if (daysRemaining <= 1) {
        status = 'critical';
      }

      const patientName = String(row.patient_name || row.party_name || 'Patient');
      const rawPhone = String(row.party_phone || '');
      const cleanPhone = formatWhatsAppPhone(rawPhone);

      const { message, link } = generateWhatsAppRefillMessage({
        patientName,
        cleanPhone,
        shopName,
        shopPhone,
        itemName: String(row.item_name),
        condition,
        qtyPurchased: qtyBase,
        daysRemaining,
        depletionDateStr,
      });

      alerts.push({
        saleId: String(row.sale_id),
        invoiceNo: String(row.invoice_no),
        customerId: row.customer_id ? String(row.customer_id) : null,
        patientName,
        patientPhone: rawPhone,
        cleanPhone,
        condition,
        itemId: String(row.item_id),
        itemName: String(row.item_name),
        genericName: String(row.generic_name || ''),
        qtyPurchased: qtyBase,
        lastPurchaseDate: invoiceDateStr,
        estimatedDepletionDate: depletionDateStr,
        daysRemaining,
        status,
        whatsapp: {
          link,
          message,
        },
      });
    }
  }

  // Sort alerts by urgency (lowest daysRemaining first)
  alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);

  return {
    success: true,
    timestamp: new Date().toISOString(),
    pharmacy: {
      name: shopName,
      phone: shopPhone,
      gstin: shopGstin,
    },
    summary: {
      totalScannedSales: salesRes.rows.length,
      chronicMatchesFound,
      refillsDueCount: alerts.length,
      conditionsBreakdown,
    },
    alerts,
  };
}
