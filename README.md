# PharmaPilot Next 💊
> Next.js 14 (TypeScript) High-Performance Indian Pharmacy ERP & Point-of-Sale

[![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![SQLite / libSQL](https://img.shields.io/badge/SQLite-libSQL%20WAL-003B57?logo=sqlite)](https://github.com/tursodatabase/libsql)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?logo=vercel)](https://pharmapilot-next.vercel.app)

---

## 🚀 Live Production URL
🔗 **[https://pharmapilot-next.vercel.app](https://pharmapilot-next.vercel.app)**

---

## 🌟 Key Highlights & Unified Architecture

PharmaPilot Next unifies:
1. **Clinical UI & Design System**: Left-side vertical navigation rail (collapsed 68px, smooth 260px expanded state), Executive Navy (`#0F172A`), Clinical Teal (`#0D9488`), and High-Density Split-Pane POS billing counter.
2. **Indian Statutory & Drug Compliance**:
   - **CDSCO Schedule H / H1 / X / NDPS**: Compulsory patient, doctor registration, and prescription interceptor.
   - **Multi-Batch FEFO Auto-Split**: Automatically splits sale quantities across batches strictly by First-Expiry-First-Out, with hard-blocking on expired stock.
   - **Bio-Equivalent Salt Substitutes Drawer (`F3`)**: Instantly finds in-stock equivalent formulations with dynamic savings indicators.
   - **Exact Integer Paise Math**: Zero floating-point rounding errors across line taxes, discounts, and round-offs.
   - **Indian GST Engine**: Modulo-36 GSTIN verification, 50/50 CGST/SGST intra-state split vs IGST, Table 12 HSN summaries, and 1-click official GSTR-1 Portal JSON export.
   - **Marg ERP 7-Step Migration Wizard**: Bulk Excel/CSV migration with validation preview and atomic 1-click transactional undo.
   - **Distributor Purchases**: Stockist inward entry supporting PTR/PTS, MRP, and Indian 10+2 Free bonus schemes.
   - **Thermal ESC/POS & A4 Printing**: 80mm receipt printer format, 58mm compact, and standard A4 GST Tax Invoice with dynamic NPCI UPI QR code.
   - **Zero-Cost Serverless Crons**: Automated chronic condition refill scanner alerting patients (Diabetes, Cardiac, Hypertension) via WhatsApp before medicines deplete.

---

## 📁 Application Routes

| Route | Feature | Description |
|---|---|---|
| `/pos` | **Split-Pane Billing Counter** | Alphanumeric FTS5 medicine search, barcode wedge listener (<35ms), multi-batch FEFO auto-split, slide-over salt substitute drawer, 3-in-1 print modal with UPI QR. |
| `/inventory` | **Stock & Expiry Radar** | Valuation @ PTR Cost and @ MRP Retail, smart units (`STRIP + TAB`), 30/60/90-day expiry filters, stock write-off modal. |
| `/purchases` | **Distributor Invoices** | Stockist inward entry with PTR, PTS, MRP, GST slabs, and 10+2 Free bonus scheme. |
| `/compliance` | **Statutory Drug Register** | Schedule H, H1, X, NDPS registers for drug inspector audit with 1-click CSV export and printable format. |
| `/gst-reports` | **GST Tax Hub** | GSTR-1 outward supplies, GSTR-3B summary, Table 12 HSN summary, 1-click GSTR-1 JSON export. |
| `/import` | **Marg Migration** | 7-step Excel / CSV migration wizard supporting Opening Stock, Medicine Master, Customer Master, Supplier Master, Doctor Master with 1-click Undo. |
| `/accounts` | **Ledger & Cash Book** | Cash book day closing, party receivables/payables, customer credit ageing analysis (0–30, 31–60, 61–90, 90+ days). |

---

## 🛠️ Local Development

```bash
# Clone the repository
git clone https://github.com/Aryan-Protein-Vala/pharmapilot-next.git
cd pharmapilot-next

# Install dependencies
npm install

# Run database migration & seed sample medicines
npx tsx src/scripts/seed.ts

# Start local dev server
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to view the application.

---

## 🧪 Running Tests

```bash
npm test
```
Runs comprehensive Vitest unit and property tests across:
- Integer Paise arithmetic & Indian English amount conversion
- GST calculation & Modulo-36 GSTIN validation
- FEFO multi-batch allocation & expiry blocker
- Database schema, FTS5 triggers, and chronic refill crons

---

## 📜 License
MIT License. Built for Indian Retail Pharmacies.
