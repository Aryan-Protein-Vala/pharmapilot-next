"use client";

import React, { useState, useEffect } from "react";
import {
  Truck,
  Plus,
  Trash2,
  Receipt,
  CheckCircle2,
  AlertCircle,
  FileText,
  Calendar,
  Building,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR, paiseToRupeesStr } from "@/lib/money";

interface Supplier {
  id: string;
  name: string;
  gstin: string;
  state_code: string;
  phone: string;
}

interface ItemOption {
  id: string;
  name: string;
  genericName: string;
  baseUnit: string;
  saleUnit: string;
  packSize: number;
  gstRateBp: number;
}

interface PurchaseLine {
  id: string;
  itemId: string;
  batchNo: string;
  expiryDate: string; // YYYY-MM-DD
  qtyPacks: number;
  freePacks: number; // 10+2 bonus scheme
  ptrRupees: string;
  mrpRupees: string;
  discountPct: number;
  gstRateBp: number;
}

interface RecentPurchase {
  id: string;
  supplier_invoice_no: string;
  invoice_date: string;
  entry_no: string;
  subtotal_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  payment_mode: string;
  supplier_name: string;
  item_count: number;
}

export default function PurchasesPage() {
  const { success, warning, error, info } = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<RecentPurchase[]>([]);
  const [loading, setLoading] = useState(true);

  // Form Header State
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMode, setPaymentMode] = useState<"credit" | "cash" | "upi">("credit");

  // Grid Lines
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchPurchasesData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/purchases");
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data.suppliers || []);
        setItems(data.items || []);
        setRecentPurchases(data.recentPurchases || []);
        if (data.suppliers && data.suppliers.length > 0 && !supplierId) {
          setSupplierId(data.suppliers[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load purchases catalog", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPurchasesData();
  }, []);

  const addLine = (itemIdToAdd?: string) => {
    const id = itemIdToAdd || selectedItemId || items[0]?.id;
    const itm = items.find((i) => i.id === id);
    if (!itm) return;

    const newLine: PurchaseLine = {
      id: `pline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      itemId: itm.id,
      batchNo: "BT" + Math.floor(1000 + Math.random() * 9000),
      expiryDate: "2027-12-31",
      qtyPacks: 10,
      freePacks: 2, // 10+2 Free Bonus Scheme
      ptrRupees: "70.00",
      mrpRupees: "100.00",
      discountPct: 0,
      gstRateBp: itm.gstRateBp || 1200,
    };

    setLines((prev) => [...prev, newLine]);
    setSelectedItemId("");
  };

  // Tax calculations on Billed units only
  const computedLines = lines.map((l, idx) => {
    const itm = items.find((i) => i.id === l.itemId);
    const ptrPaise = Math.round((parseFloat(l.ptrRupees) || 0) * 100);
    const mrpPaise = Math.round((parseFloat(l.mrpRupees) || 0) * 100);
    const billedQty = l.qtyPacks || 0;
    const freeQty = l.freePacks || 0;
    const totalPacks = billedQty + freeQty;

    // GST applies strictly to billed units
    const grossPaise = Math.round(billedQty * ptrPaise);
    const discPaise = Math.round((grossPaise * ((l.discountPct || 0) * 100)) / 10000);
    const taxablePaise = grossPaise - discPaise;
    const taxPaise = Math.round((taxablePaise * l.gstRateBp) / 10000);
    const lineTotalPaise = taxablePaise + taxPaise;

    // Effective Cost per pack considering scheme free units
    const effCostPerPackPaise = totalPacks > 0 ? Math.round(lineTotalPaise / totalPacks) : ptrPaise;
    const marginPct = mrpPaise > 0 ? (((mrpPaise - effCostPerPackPaise) / mrpPaise) * 100) : 0;

    return {
      ...l,
      idx,
      itm,
      ptrPaise,
      mrpPaise,
      totalPacks,
      taxablePaise,
      taxPaise,
      lineTotalPaise,
      effCostPerPackPaise,
      marginPct,
    };
  });

  const subtotalPaise = computedLines.reduce((sum, l) => sum + l.taxablePaise, 0);
  const totalTaxPaise = computedLines.reduce((sum, l) => sum + l.taxPaise, 0);
  const exactTotalPaise = computedLines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  const roundRemainder = ((exactTotalPaise % 100) + 100) % 100;
  const roundOffPaise = roundRemainder >= 50 ? 100 - roundRemainder : -roundRemainder;
  const grandTotalPaise = exactTotalPaise + roundOffPaise;

  const handleSubmit = async () => {
    if (!supplierId) {
      warning("Select Supplier", "Please select a distributor / supplier.");
      return;
    }
    if (!supplierInvoiceNo.trim()) {
      warning("Missing Invoice No", "Please enter supplier invoice number.");
      return;
    }
    if (lines.length === 0) {
      warning("Empty Invoice", "Add at least one medicine line.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        supplierId,
        supplierInvoiceNo: supplierInvoiceNo.trim(),
        invoiceDate,
        paymentMode,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          batchNo: l.batchNo.trim().toUpperCase(),
          expiryDate: l.expiryDate,
          qtyPacks: l.qtyPacks,
          freePacks: l.freePacks,
          ptrRupees: parseFloat(l.ptrRupees) || 0,
          mrpRupees: parseFloat(l.mrpRupees) || 0,
          discountPct: l.discountPct,
          gstRateBp: l.gstRateBp,
        })),
      };

      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to commit purchase invoice");
      }

      const result = await res.json();
      success("Purchase Inward Posted", `Entry ${result.entryNo} created with stock & ledger updates.`);

      // Reset form
      setSupplierInvoiceNo("");
      setLines([]);
      fetchPurchasesData();
    } catch (err: any) {
      error("Purchase Error", err.message || "Failed to post purchase entry.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto select-none">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              Distributor Purchase Inward
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              Bonus Scheme 10+2
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Tax applies strictly to billed units; stock increments by billed + free bonus units atomically.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchPurchasesData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-teal-600" : "text-slate-500"}`} />
            <span>Sync</span>
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || lines.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
            <span>Post Inward Invoice</span>
          </button>
        </div>
      </div>

      {/* Supplier & Invoice Header Card */}
      <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Supplier / Stockist *
            </label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-teal-500"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (GSTIN: {s.gstin || "Unregistered"})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Supplier Invoice No *
            </label>
            <input
              type="text"
              placeholder="e.g. INV-9042"
              value={supplierInvoiceNo}
              onChange={(e) => setSupplierInvoiceNo(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Invoice Date *
            </label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Payment Terms
            </label>
            <select
              value={paymentMode}
              onChange={(e: any) => setPaymentMode(e.target.value)}
              className="w-full h-8 px-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-teal-500"
            >
              <option value="credit">Credit (Post to Supplier Ledger)</option>
              <option value="cash">Cash Paid</option>
              <option value="upi">Bank / UPI Transfer</option>
            </select>
          </div>
        </div>
      </div>

      {/* Line Items Entry Grid */}
      <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden flex flex-col">
        {/* Table Toolbar */}
        <div className="p-3 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="h-8 px-2 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 flex-1 focus:outline-none focus:border-teal-500"
            >
              <option value="">Select medicine SKU to add...</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.genericName})
                </option>
              ))}
            </select>
            <button
              onClick={() => selectedItemId && addLine(selectedItemId)}
              disabled={!selectedItemId}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Add Line</span>
            </button>
          </div>

          <span className="text-[11px] text-slate-500">
            Bonus Scheme Rule: Stock = Billed + Free; Tax = Billed only.
          </span>
        </div>

        {/* Lines Table */}
        <div className="overflow-x-auto">
          {lines.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No items on this purchase invoice. Select a medicine above to add lines.
            </div>
          ) : (
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Medicine</th>
                  <th className="py-2.5 px-2 text-center">Batch No</th>
                  <th className="py-2.5 px-2 text-center">Expiry (YYYY-MM-DD)</th>
                  <th className="py-2.5 px-2 text-center">Billed (Pack)</th>
                  <th className="py-2.5 px-2 text-center">Free Bonus</th>
                  <th className="py-2.5 px-2 text-right">PTR (₹)</th>
                  <th className="py-2.5 px-2 text-right">MRP (₹)</th>
                  <th className="py-2.5 px-2 text-center">Disc %</th>
                  <th className="py-2.5 px-2 text-center">GST</th>
                  <th className="py-2.5 px-2 text-right">Eff. Margin</th>
                  <th className="py-2.5 px-3 text-right">Line Total</th>
                  <th className="py-2.5 px-2 text-center">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {computedLines.map((line) => (
                  <tr key={line.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2 px-3">
                      <div className="font-semibold text-navy-900 dark:text-slate-100">{line.itm?.name}</div>
                      <div className="text-[10px] text-slate-400">{line.itm?.genericName}</div>
                    </td>

                    <td className="py-2 px-2 text-center">
                      <input
                        type="text"
                        value={line.batchNo}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          setLines((prev) =>
                            prev.map((l, i) => (i === line.idx ? { ...l, batchNo: val } : l))
                          );
                        }}
                        className="w-20 h-6 px-1.5 text-center font-mono text-xs rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                      />
                    </td>

                    <td className="py-2 px-2 text-center">
                      <input
                        type="date"
                        value={line.expiryDate}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((l, i) => (i === line.idx ? { ...l, expiryDate: val } : l))
                          );
                        }}
                        className="w-28 h-6 px-1 text-center font-mono text-xs rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                      />
                    </td>

                    <td className="py-2 px-2 text-center">
                      <input
                        type="number"
                        min="1"
                        value={line.qtyPacks}
                        onChange={(e) => {
                          const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                          setLines((prev) =>
                            prev.map((l, i) => (i === line.idx ? { ...l, qtyPacks: val } : l))
                          );
                        }}
                        className="w-14 h-6 px-1 text-center font-mono text-xs font-bold rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                      />
                    </td>

                    <td className="py-2 px-2 text-center">
                      <input
                        type="number"
                        min="0"
                        value={line.freePacks}
                        onChange={(e) => {
                          const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                          setLines((prev) =>
                            prev.map((l, i) => (i === line.idx ? { ...l, freePacks: val } : l))
                          );
                        }}
                        className="w-12 h-6 px-1 text-center font-mono text-xs font-semibold text-teal-700 dark:text-teal-400 rounded border border-teal-200 dark:border-teal-800 bg-teal-50/50 dark:bg-teal-950/40"
                      />
                    </td>

                    <td className="py-2 px-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={line.ptrRupees}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((l, i) => (i === line.idx ? { ...l, ptrRupees: val } : l))
                          );
                        }}
                        className="w-16 h-6 px-1 text-right font-mono text-xs rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                      />
                    </td>

                    <td className="py-2 px-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={line.mrpRupees}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((l, i) => (i === line.idx ? { ...l, mrpRupees: val } : l))
                          );
                        }}
                        className="w-16 h-6 px-1 text-right font-mono text-xs font-semibold rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                      />
                    </td>

                    <td className="py-2 px-2 text-center">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={line.discountPct}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setLines((prev) =>
                            prev.map((l, i) => (i === line.idx ? { ...l, discountPct: val } : l))
                          );
                        }}
                        className="w-12 h-6 px-1 text-center font-mono text-xs rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                      />
                    </td>

                    <td className="py-2 px-2 text-center font-mono">
                      {(line.gstRateBp / 100).toFixed(0)}%
                    </td>

                    <td className="py-2 px-2 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {line.marginPct.toFixed(1)}%
                    </td>

                    <td className="py-2 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                      {formatINR(line.lineTotalPaise)}
                    </td>

                    <td className="py-2 px-2 text-center">
                      <button
                        onClick={() => setLines((prev) => prev.filter((_, i) => i !== line.idx))}
                        className="p-1 rounded text-slate-400 hover:text-rose-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Invoice Summary Box */}
        <div className="p-4 border-t border-slate-200 dark:border-navy-700 bg-slate-50/70 dark:bg-navy-900/50 flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-500">
            Total Billed: <strong className="font-mono text-slate-700 dark:text-slate-300">{computedLines.reduce((s, l) => s + l.qtyPacks, 0)} Packs</strong> · Free Bonus: <strong className="font-mono text-teal-700 dark:text-teal-400">{computedLines.reduce((s, l) => s + l.freePacks, 0)} Packs</strong>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <div>Taxable: <strong className="text-slate-800 dark:text-slate-200">{formatINR(subtotalPaise)}</strong></div>
            <div>GST: <strong className="text-slate-800 dark:text-slate-200">{formatINR(totalTaxPaise)}</strong></div>
            <div>Round-Off: <strong className="text-slate-800 dark:text-slate-200">{formatINR(roundOffPaise)}</strong></div>
            <div className="text-sm font-bold text-navy-900 dark:text-slate-100">
              Total: {formatINR(grandTotalPaise)}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Purchases Inward Log */}
      <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-teal-600 stroke-[2]" />
            <h3 className="font-semibold text-xs text-navy-900 dark:text-slate-100">
              Recent Purchase Invoices Posted
            </h3>
          </div>
          <span className="text-[10px] text-slate-400 font-mono">Registry Log</span>
        </div>

        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-2.5 px-3">Entry #</th>
              <th className="py-2.5 px-3">Supplier</th>
              <th className="py-2.5 px-3">Supplier Inv #</th>
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-2 text-center">Items</th>
              <th className="py-2.5 px-2 text-center">Mode</th>
              <th className="py-2.5 px-3 text-right">Taxable</th>
              <th className="py-2.5 px-3 text-right">GST</th>
              <th className="py-2.5 px-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
            {recentPurchases.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                <td className="py-2.5 px-3 font-mono font-medium text-teal-700 dark:text-teal-400">{p.entry_no}</td>
                <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">{p.supplier_name}</td>
                <td className="py-2.5 px-3 font-mono">{p.supplier_invoice_no}</td>
                <td className="py-2.5 px-3 font-mono text-slate-500">{p.invoice_date}</td>
                <td className="py-2.5 px-2 text-center font-mono">{p.item_count}</td>
                <td className="py-2.5 px-2 text-center uppercase font-mono text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-navy-700 text-slate-700 dark:text-slate-300">
                    {p.payment_mode}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right font-mono">{formatINR(p.subtotal_paise)}</td>
                <td className="py-2.5 px-3 text-right font-mono">{formatINR(p.cgst_paise + p.sgst_paise + p.igst_paise)}</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                  {formatINR(p.total_paise)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
