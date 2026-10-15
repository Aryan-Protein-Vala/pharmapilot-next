"use client";

import React, { useState, useEffect } from "react";
import {
  RotateCcw,
  Search,
  Plus,
  Trash2,
  Printer,
  X,
  Check,
  User,
  CreditCard,
  FileText,
  AlertCircle,
  ShieldAlert,
  DollarSign,
  History,
  Calendar,
  Package,
  Receipt,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { formatINR, paiseToRupeesStr, rupeesToPaise } from "@/lib/money";

export interface ReturnSlipLine {
  id: string;
  itemId: string;
  itemName: string;
  batchId: string;
  batchNo: string;
  expiryDate: string;
  baseUnit: string;
  qtyBase: number;
  rateRupees: string;
  ratePaise: number;
  disposition: "restock" | "damage" | "expiry_writeoff";
  maxQty?: number;
}

interface SalesReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: any[];
  shop: any;
  onReturnSuccess?: (result: any) => void;
}

export function SalesReturnModal({
  isOpen,
  onClose,
  customers,
  shop,
  onReturnSuccess,
}: SalesReturnModalProps) {
  const [tab, setTab] = useState<"new" | "recent">("new");

  // Step A: Bill Lookup state
  const [lookupInvoiceNo, setLookupInvoiceNo] = useState("");
  const [isSearchingInvoice, setIsSearchingInvoice] = useState(false);
  const [lookedUpInvoice, setLookedUpInvoice] = useState<any | null>(null);
  const [lookedUpItems, setLookedUpItems] = useState<any[]>([]);

  // Step A Alternative: Manual Medicine Search
  const [manualQuery, setManualQuery] = useState("");
  const [manualResults, setManualResults] = useState<any[]>([]);
  const [isSearchingManual, setIsSearchingManual] = useState(false);
  const [selectedManualItem, setSelectedManualItem] = useState<any | null>(null);
  const [selectedManualBatchId, setSelectedManualBatchId] = useState("");

  // Step B: Return Lines
  const [returnLines, setReturnLines] = useState<ReturnSlipLine[]>([]);

  // Step C: Return Configuration
  const [customerId, setCustomerId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [reason, setReason] = useState("");
  const [refundMode, setRefundMode] = useState<"cash" | "credit">("cash");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Step D: Print Receipt Modal
  const [creditNoteReceipt, setCreditNoteReceipt] = useState<any | null>(null);
  const [printFormat, setPrintFormat] = useState<"80mm" | "a4">("80mm");

  // Recent Returns
  const [recentReturns, setRecentReturns] = useState<any[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  // Load recent returns on open or tab switch
  useEffect(() => {
    if (isOpen) {
      loadRecentReturns();
    }
  }, [isOpen]);

  const loadRecentReturns = async () => {
    try {
      setLoadingRecent(true);
      const res = await fetch("/api/pos/returns?limit=25");
      if (res.ok) {
        const data = await res.json();
        setRecentReturns(data.returns || []);
      }
    } catch (err) {
      console.error("Failed to load recent sales returns:", err);
    } finally {
      setLoadingRecent(false);
    }
  };

  // Debounced search for manual medicine lookup (150ms)
  useEffect(() => {
    if (!manualQuery.trim()) {
      setManualResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setIsSearchingManual(true);
        const res = await fetch(`/api/pos/search?q=${encodeURIComponent(manualQuery.trim())}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          setManualResults(data.results || []);
        }
      } catch (err) {
        console.error("Manual search failed:", err);
      } finally {
        setIsSearchingManual(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [manualQuery]);

  if (!isOpen) return null;

  // Handle Invoice Lookup
  const handleLookupBill = async () => {
    const cleanNo = lookupInvoiceNo.trim();
    if (!cleanNo) {
      setErrorMessage("Enter an invoice number (e.g. INV-260001).");
      return;
    }
    setErrorMessage("");
    try {
      setIsSearchingInvoice(true);
      const res = await fetch(`/api/pos/returns?invoiceNo=${encodeURIComponent(cleanNo)}`);
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || `Invoice "${cleanNo}" not found`);
      }
      const data = await res.json();
      const sale = data.sale || data.invoice;
      setLookedUpInvoice(sale);
      setLookedUpItems(data.items || []);
      if (sale?.customer_id) {
        setCustomerId(sale.customer_id);
      }
      if (sale?.patient_name) {
        setPatientName(sale.patient_name);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Invoice lookup failed");
      setLookedUpInvoice(null);
      setLookedUpItems([]);
    } finally {
      setIsSearchingInvoice(false);
    }
  };

  // Add line from looked-up bill
  const addLineFromInvoice = (item: any) => {
    const existing = returnLines.find(
      (l) => l.itemId === item.item_id && l.batchId === item.batch_id
    );
    if (existing) {
      setErrorMessage(`${item.item_name} is already in the return slip.`);
      return;
    }
    setErrorMessage("");

    const billedQty = Number(item.qty_base || 1);
    const unitRatePaise = Number(item.rate_paise || item.mrp_paise || 0);

    const line: ReturnSlipLine = {
      id: `ret_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      itemId: item.item_id,
      itemName: item.item_name,
      batchId: item.batch_id,
      batchNo: item.batch_no,
      expiryDate: item.expiry_date,
      baseUnit: item.base_unit || "TAB",
      qtyBase: billedQty,
      rateRupees: paiseToRupeesStr(unitRatePaise),
      ratePaise: unitRatePaise,
      disposition: "restock",
      maxQty: billedQty,
    };

    setReturnLines((prev) => [...prev, line]);
  };

  // Add line manually
  const addManualLine = () => {
    if (!selectedManualItem) {
      setErrorMessage("Select a medicine first.");
      return;
    }
    const batch =
      selectedManualItem.batches.find((b: any) => b.id === selectedManualBatchId) ||
      selectedManualItem.batches[0];
    if (!batch) {
      setErrorMessage("Medicine has no available batches.");
      return;
    }

    const existing = returnLines.find(
      (l) => l.itemId === selectedManualItem.id && l.batchId === batch.id
    );
    if (existing) {
      setErrorMessage(`${selectedManualItem.name} batch ${batch.batchNo} is already in return slip.`);
      return;
    }
    setErrorMessage("");

    const packSize = Number(selectedManualItem.packSize || 1);
    const unitRatePaise = Math.round(Number(batch.mrpPaise || 0) / packSize);

    const line: ReturnSlipLine = {
      id: `ret_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      itemId: selectedManualItem.id,
      itemName: selectedManualItem.name,
      batchId: batch.id,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      baseUnit: selectedManualItem.baseUnit || "TAB",
      qtyBase: 1,
      rateRupees: paiseToRupeesStr(unitRatePaise),
      ratePaise: unitRatePaise,
      disposition: "restock",
    };

    setReturnLines((prev) => [...prev, line]);
    setSelectedManualItem(null);
    setManualQuery("");
    setManualResults([]);
  };

  // Update line field
  const updateLine = (id: string, updates: Partial<ReturnSlipLine>) => {
    setReturnLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...updates };
        if (updates.rateRupees !== undefined) {
          next.ratePaise = rupeesToPaise(updates.rateRupees);
        }
        if (updates.qtyBase !== undefined && l.maxQty !== undefined) {
          next.qtyBase = Math.min(Math.max(1, updates.qtyBase), l.maxQty);
        }
        return next;
      })
    );
  };

  const removeLine = (id: string) => {
    setReturnLines((prev) => prev.filter((l) => l.id !== id));
  };

  // Return Totals
  const totalReturnPaise = returnLines.reduce(
    (sum, l) => sum + Math.round(l.qtyBase * l.ratePaise),
    0
  );
  const gstRateBp = 1200; // 12% standard GST
  const taxablePaise = Math.round((totalReturnPaise * 10000) / (10000 + gstRateBp));
  const taxPaise = totalReturnPaise - taxablePaise;

  // Submit Sales Return
  const handleSubmitReturn = async () => {
    if (returnLines.length === 0) {
      setErrorMessage("Add at least one medicine line to the return slip.");
      return;
    }

    if (refundMode === "credit" && !customerId) {
      setErrorMessage("Credit note refund requires selecting a registered customer account.");
      return;
    }

    setErrorMessage("");
    try {
      setIsSubmitting(true);
      const payload = {
        originalInvoiceNo: lookupInvoiceNo.trim() || undefined,
        customerId: customerId || undefined,
        refundMode,
        reason: reason.trim() || "Customer Medicine Return (Grahak Wapsi)",
        items: returnLines.map((l) => ({
          itemId: l.itemId,
          batchId: l.batchId,
          qtyBase: l.qtyBase,
          ratePaise: l.ratePaise,
          disposition: l.disposition,
        })),
      };

      const res = await fetch("/api/pos/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to process sales return");
      }

      const result = await res.json();

      const cust = customers.find((c) => c.id === customerId);
      const receiptData = {
        ...result,
        shop,
        customerName: cust?.name || patientName || "Walk-in Retail Customer",
        customerPhone: cust?.phone || "",
        items: returnLines,
      };

      setCreditNoteReceipt(receiptData);

      // Reset form
      setReturnLines([]);
      setLookupInvoiceNo("");
      setLookedUpInvoice(null);
      setLookedUpItems([]);
      setReason("");
      setCustomerId("");
      setPatientName("");

      loadRecentReturns();
      if (onReturnSuccess) {
        onReturnSuccess(result);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to process sales return");
    } finally {
      setIsSubmitting(false);
    }
  };

  const presetReasons = [
    "Doctor Changed Prescription",
    "Patient Recovered / Excess Strips",
    "Wrong Medicine Dispensed",
    "Intact Sealed Pack Returned",
    "Defective / Damaged Packaging",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/70 backdrop-blur-sm p-3 overflow-y-auto">
      <div className="w-full max-w-4xl bg-white dark:bg-navy-900 rounded-xl shadow-2xl border border-slate-200 dark:border-navy-700 flex flex-col max-h-[92vh] overflow-hidden my-auto animate-in fade-in duration-150">
        {/* Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-navy-800 flex items-center justify-between bg-slate-50/80 dark:bg-navy-950/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800">
              <RotateCcw className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-navy-900 dark:text-slate-100">
                Sales Return & Credit Note (Grahak Wapsi)
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Restock returned medicines to batches, issue cash refund or customer ledger credit
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Tab Switcher */}
            <div className="flex items-center p-0.5 rounded-lg border border-slate-200 dark:border-navy-700 bg-slate-100 dark:bg-navy-800 text-xs">
              <button
                onClick={() => setTab("new")}
                className={`px-3 py-1 font-semibold rounded-md transition-colors ${
                  tab === "new"
                    ? "bg-white dark:bg-navy-900 text-teal-700 dark:text-teal-300 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-navy-900 dark:hover:text-slate-200"
                }`}
              >
                New Return
              </button>
              <button
                onClick={() => setTab("recent")}
                className={`px-3 py-1 font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                  tab === "recent"
                    ? "bg-white dark:bg-navy-900 text-teal-700 dark:text-teal-300 shadow-sm"
                    : "text-slate-600 dark:text-slate-400 hover:text-navy-900 dark:hover:text-slate-200"
                }`}
              >
                <History className="w-3.5 h-3.5 stroke-[2]" />
                <span>Recent Returns ({recentReturns.length})</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-navy-800 transition-colors"
            >
              <X className="w-4 h-4 stroke-[2]" />
            </button>
          </div>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div className="px-5 py-2 bg-rose-50 dark:bg-rose-950/60 border-b border-rose-200 dark:border-rose-900 flex items-center justify-between text-xs text-rose-700 dark:text-rose-300 shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 stroke-[2] shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage("")} className="text-rose-500 hover:text-rose-700">
              <X className="w-3.5 h-3.5 stroke-[2]" />
            </button>
          </div>
        )}

        {/* Tab 1: New Return Workspace */}
        {tab === "new" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Step A: Past Bill Lookup & Manual Medicine Search */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Box 1: Lookup Past Bill */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-navy-700 bg-slate-50/60 dark:bg-navy-800/40 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-navy-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-teal-600 stroke-[2]" />
                    Option 1: Lookup Original Bill
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Auto-populates items & rate</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      placeholder="e.g. INV-260001"
                      value={lookupInvoiceNo}
                      onChange={(e) => setLookupInvoiceNo(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && handleLookupBill()}
                      className="w-full h-8 pl-8 pr-2 text-xs font-mono rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500 uppercase"
                    />
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400 stroke-[2]" />
                  </div>
                  <button
                    onClick={handleLookupBill}
                    disabled={isSearchingInvoice || !lookupInvoiceNo.trim()}
                    className="h-8 px-3 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium transition-colors disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {isSearchingInvoice ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5 stroke-[2]" />
                    )}
                    <span>Lookup</span>
                  </button>
                </div>

                {/* Bill preview if loaded */}
                {lookedUpInvoice && (
                  <div className="pt-2 border-t border-slate-200 dark:border-navy-700 text-xs space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
                      <span><strong>Bill:</strong> {lookedUpInvoice.invoice_no} ({lookedUpInvoice.invoice_date})</span>
                      <span><strong>Total:</strong> {formatINR(lookedUpInvoice.total_paise)}</span>
                    </div>

                    <div className="max-h-32 overflow-y-auto divide-y divide-slate-200 dark:divide-navy-700 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900">
                      {lookedUpItems.map((itm) => (
                        <div key={itm.sale_item_id} className="p-2 flex items-center justify-between text-[11px]">
                          <div>
                            <div className="font-semibold text-navy-900 dark:text-slate-100">{itm.item_name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              Batch: {itm.batch_no} · Billed: {itm.qty_base} {itm.base_unit} · {formatINR(itm.rate_paise)}
                            </div>
                          </div>
                          <button
                            onClick={() => addLineFromInvoice(itm)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 transition-colors"
                          >
                            <Plus className="w-3 h-3 stroke-[2.5]" />
                            <span>Return</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Box 2: Manual Medicine & Batch Search */}
              <div className="p-3.5 rounded-lg border border-slate-200 dark:border-navy-700 bg-slate-50/60 dark:bg-navy-800/40 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-navy-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-teal-600 stroke-[2]" />
                    Option 2: Manual Medicine Search
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">FTS5 Debounced (150ms)</span>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search name, salt, or barcode..."
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                    className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400 stroke-[2]" />
                  {isSearchingManual && (
                    <div className="absolute right-2.5 top-2.5 w-3 h-3 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                  )}
                </div>

                {/* Dropdown search results */}
                {manualResults.length > 0 && !selectedManualItem && (
                  <div className="max-h-36 overflow-y-auto rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 divide-y divide-slate-100 dark:divide-navy-800">
                    {manualResults.map((itm) => (
                      <div
                        key={itm.id}
                        onClick={() => {
                          setSelectedManualItem(itm);
                          if (itm.batches && itm.batches.length > 0) {
                            setSelectedManualBatchId(itm.batches[0].id);
                          }
                        }}
                        className="p-2 hover:bg-slate-50 dark:hover:bg-navy-800 cursor-pointer flex items-center justify-between text-[11px]"
                      >
                        <div>
                          <div className="font-semibold text-navy-900 dark:text-slate-100">{itm.name}</div>
                          <div className="text-[10px] text-slate-400">{itm.genericName}</div>
                        </div>
                        <span className="text-[10px] text-teal-600 font-mono font-semibold">
                          {itm.batches?.length || 0} Batches
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Batch picker for selected medicine */}
                {selectedManualItem && (
                  <div className="pt-2 border-t border-slate-200 dark:border-navy-700 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-navy-900 dark:text-slate-100 truncate max-w-[200px]">
                        {selectedManualItem.name}
                      </span>
                      <button
                        onClick={() => setSelectedManualItem(null)}
                        className="text-[10px] text-slate-400 hover:text-slate-600"
                      >
                        Change
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        value={selectedManualBatchId}
                        onChange={(e) => setSelectedManualBatchId(e.target.value)}
                        className="flex-1 h-8 px-2 text-xs rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-mono"
                      >
                        {selectedManualItem.batches.map((b: any) => (
                          <option key={b.id} value={b.id}>
                            Batch {b.batchNo} (Exp: {b.expiryDate}) — {formatINR(b.mrpPaise)}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={addManualLine}
                        className="h-8 px-3 rounded bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step B: Active Return Slip Table */}
            <div className="rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 shadow-sm overflow-hidden flex flex-col">
              <div className="px-4 py-2 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/40 flex items-center justify-between text-xs">
                <span className="font-bold text-navy-900 dark:text-slate-100">
                  Return Slip Items ({returnLines.length})
                </span>
                <span className="text-[11px] text-slate-400">
                  Select disposition per item to determine stock restoration
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-navy-700 text-slate-500 text-[11px] bg-slate-50/30 dark:bg-navy-900/20">
                      <th className="text-left px-3 py-2 font-semibold">Medicine</th>
                      <th className="text-left px-3 py-2 font-semibold">Batch & Expiry</th>
                      <th className="text-center px-3 py-2 font-semibold w-24">Return Qty</th>
                      <th className="text-right px-3 py-2 font-semibold w-28">Rate (₹)</th>
                      <th className="text-left px-3 py-2 font-semibold w-48">Disposition</th>
                      <th className="text-right px-3 py-2 font-semibold w-24">Line Total</th>
                      <th className="text-center px-2 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                    {returnLines.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-slate-400 text-xs">
                          No return items added yet. Lookup an invoice or search medicines above.
                        </td>
                      </tr>
                    ) : (
                      returnLines.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50/60 dark:hover:bg-navy-750">
                          <td className="px-3 py-2 font-semibold text-navy-900 dark:text-slate-100">
                            {l.itemName}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                            {l.batchNo} <span className="text-[10px] text-slate-400">({l.expiryDate})</span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number"
                                min={1}
                                max={l.maxQty}
                                value={l.qtyBase}
                                onChange={(e) =>
                                  updateLine(l.id, { qtyBase: parseInt(e.target.value, 10) || 1 })
                                }
                                className="w-16 h-7 text-center font-mono rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
                              />
                              <span className="text-[10px] text-slate-400">{l.baseUnit}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              value={l.rateRupees}
                              onChange={(e) => updateLine(l.id, { rateRupees: e.target.value })}
                              className="w-20 h-7 text-right font-mono rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={l.disposition}
                              onChange={(e: any) => updateLine(l.id, { disposition: e.target.value })}
                              className="w-full h-7 px-2 text-[11px] font-medium rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none"
                            >
                              <option value="restock">Restock to Shelf (+Stock)</option>
                              <option value="damage">Damaged (No Restock)</option>
                              <option value="expiry_writeoff">Expired Write-Off (No Restock)</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                            {formatINR(Math.round(l.qtyBase * l.ratePaise))}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button
                              onClick={() => removeLine(l.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                              title="Remove item"
                            >
                              <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Step C: Return Reason & Refund Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Customer & Reason */}
              <div className="space-y-3 p-3.5 rounded-lg border border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-800/30">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Customer Account (Mandatory for Credit Note Ledger)
                  </label>
                  <div className="relative">
                    <select
                      value={customerId}
                      onChange={(e) => {
                        setCustomerId(e.target.value);
                        const c = customers.find((cust) => cust.id === e.target.value);
                        if (c) setPatientName(c.name);
                      }}
                      className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
                    >
                      <option value="">Walk-in Retail Customer</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.phone || "No Ph"})
                        </option>
                      ))}
                    </select>
                    <User className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400 stroke-[2]" />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                    Return Reason
                  </label>
                  <input
                    type="text"
                    placeholder="Enter reason for medicine return..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500 mb-1.5"
                  />
                  {/* Preset chips */}
                  <div className="flex flex-wrap gap-1">
                    {presetReasons.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setReason(r)}
                        className="px-2 py-0.5 text-[10px] rounded-full border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-slate-600 dark:text-slate-300 hover:border-teal-500 transition-colors"
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Refund Method & Summary */}
              <div className="space-y-3 p-3.5 rounded-lg border border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-800/30 flex flex-col justify-between">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                    Refund Mode
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRefundMode("cash")}
                      className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition-all ${
                        refundMode === "cash"
                          ? "border-teal-500 bg-teal-50/60 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200 ring-1 ring-teal-500"
                          : "border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      <DollarSign className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-xs">Cash Refund</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">Cash handed to patient</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setRefundMode("credit")}
                      className={`p-2.5 rounded-lg border text-left flex items-start gap-2 transition-all ${
                        refundMode === "credit"
                          ? "border-teal-500 bg-teal-50/60 dark:bg-teal-950/40 text-teal-900 dark:text-teal-200 ring-1 ring-teal-500"
                          : "border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      <CreditCard className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-xs">Credit Note Ledger</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">Credit to customer khata</div>
                      </div>
                    </button>
                  </div>
                </div>

                {/* Financial Summary */}
                <div className="pt-2 border-t border-slate-200 dark:border-navy-700 space-y-1 text-xs">
                  <div className="flex justify-between text-slate-500 dark:text-slate-400">
                    <span>Taxable Value:</span>
                    <span className="font-mono">{formatINR(taxablePaise)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500 dark:text-slate-400">
                    <span>GST (Estimated 12%):</span>
                    <span className="font-mono">{formatINR(taxPaise)}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-slate-200 dark:border-navy-700 text-sm font-bold text-navy-900 dark:text-slate-100">
                    <span>Net Refund Amount:</span>
                    <span className="text-base font-mono text-teal-700 dark:text-teal-300 tabular-nums">
                      {formatINR(totalReturnPaise)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Recent Returns History */}
        {tab === "recent" && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 shadow-sm overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/40 flex items-center justify-between">
                <span className="text-xs font-bold text-navy-900 dark:text-slate-100">
                  Recent Sales Returns Register
                </span>
                <button
                  onClick={loadRecentReturns}
                  disabled={loadingRecent}
                  className="text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingRecent ? "animate-spin" : ""}`} />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-navy-700 text-slate-500 text-[11px] bg-slate-50/30 dark:bg-navy-900/20">
                      <th className="text-left px-3 py-2 font-semibold">Return No</th>
                      <th className="text-left px-3 py-2 font-semibold">Date</th>
                      <th className="text-left px-3 py-2 font-semibold">Customer</th>
                      <th className="text-left px-3 py-2 font-semibold">Original Bill</th>
                      <th className="text-left px-3 py-2 font-semibold">Refund Mode</th>
                      <th className="text-left px-3 py-2 font-semibold">Reason</th>
                      <th className="text-right px-3 py-2 font-semibold">Total Amount</th>
                      <th className="text-center px-3 py-2 font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                    {recentReturns.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="text-center py-10 text-slate-400 text-xs">
                          No recent sales returns recorded.
                        </td>
                      </tr>
                    ) : (
                      recentReturns.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/60 dark:hover:bg-navy-750">
                          <td className="px-3 py-2 font-mono font-bold text-teal-700 dark:text-teal-400">
                            {r.return_no}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                            {r.return_date}
                          </td>
                          <td className="px-3 py-2 font-medium text-navy-900 dark:text-slate-100">
                            {r.customer_name || "Walk-in Retail"}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                            {r.original_invoice_no || "Manual"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                r.refund_mode === "credit"
                                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                              }`}
                            >
                              {r.refund_mode}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-500 max-w-[140px] truncate">
                            {r.reason}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                            {formatINR(r.total_paise)}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => {
                                setCreditNoteReceipt({
                                  returnNo: r.return_no,
                                  returnDate: r.return_date,
                                  originalInvoiceNo: r.original_invoice_no,
                                  customerName: r.customer_name || "Walk-in Retail Customer",
                                  customerPhone: r.customer_phone || "",
                                  refundMode: r.refund_mode,
                                  subtotalPaise: r.subtotal_paise,
                                  taxPaise: r.tax_paise,
                                  totalPaise: r.total_paise,
                                  shop,
                                  items: r.items.map((itm: any) => ({
                                    itemName: itm.item_name,
                                    batchNo: itm.batch_no,
                                    expiryDate: itm.expiry_date,
                                    baseUnit: itm.base_unit || "TAB",
                                    qtyBase: itm.qty_base,
                                    ratePaise: itm.rate_paise,
                                    disposition: itm.disposition,
                                  })),
                                });
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-slate-200 dark:border-navy-700 hover:border-teal-500 text-slate-700 dark:text-slate-300"
                            >
                              <Printer className="w-3 h-3 stroke-[2]" />
                              <span>Reprint</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-navy-800 bg-slate-50/60 dark:bg-navy-950/50 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-400">
            {tab === "new" ? (
              <span>Items with disposition &quot;Restock&quot; are instantly added back to live inventory</span>
            ) : (
              <span>Showing last 25 customer credit notes</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold rounded-md border border-slate-200 dark:border-navy-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-navy-800 transition-colors"
            >
              Close
            </button>

            {tab === "new" && (
              <button
                onClick={handleSubmitReturn}
                disabled={isSubmitting || returnLines.length === 0}
                className="inline-flex items-center gap-1.5 px-5 py-1.5 text-xs font-bold rounded-md bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-colors disabled:opacity-40"
              >
                {isSubmitting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
                )}
                <span>Process Return & Issue Credit Note</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Credit Note Receipt Print Modal (80mm Thermal & A4) */}
      {creditNoteReceipt && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-navy-950/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl p-6 text-slate-900 border border-slate-200 my-auto animate-in zoom-in-95 duration-150">
            {/* Print Format Controls Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 no-print">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-teal-600 stroke-[2]" />
                <h3 className="font-bold text-sm text-navy-900">
                  Credit Note — {creditNoteReceipt.returnNo}
                </h3>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPrintFormat("80mm")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border ${
                    printFormat === "80mm"
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-slate-50 border-slate-200 text-slate-700"
                  }`}
                >
                  80mm Slip
                </button>
                <button
                  onClick={() => setPrintFormat("a4")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border ${
                    printFormat === "a4"
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-slate-50 border-slate-200 text-slate-700"
                  }`}
                >
                  A4 Credit Note
                </button>
                <button
                  onClick={() => setCreditNoteReceipt(null)}
                  className="p-1 rounded text-slate-400 hover:text-slate-600 ml-2"
                >
                  <X className="w-4 h-4 stroke-[2]" />
                </button>
              </div>
            </div>

            {/* Printable Container */}
            <div
              className={`mt-4 mx-auto p-4 bg-white border border-slate-200 text-slate-900 ${
                printFormat === "80mm" ? "max-w-[360px] text-xs font-mono" : "w-full text-xs"
              }`}
            >
              {/* Pharmacy Title */}
              <div className="text-center pb-3 border-b border-slate-300">
                <h2 className="text-sm font-bold tracking-tight uppercase">
                  {creditNoteReceipt.shop?.name || "PharmaPilot Wellness Pharmacy"}
                </h2>
                <div className="text-[10px] text-slate-600">
                  {creditNoteReceipt.shop?.address}
                </div>
                <div className="text-[10px] text-slate-600 font-mono">
                  GSTIN: {creditNoteReceipt.shop?.gstin} · DL: {creditNoteReceipt.shop?.drug_license_no_1}
                </div>
                <div className="mt-1 inline-block px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-300 rounded uppercase">
                  TAX CREDIT NOTE / GRAHAK WAPSI RASEED
                </div>
              </div>

              {/* Meta */}
              <div className="py-2.5 flex justify-between text-[11px] border-b border-slate-200">
                <div>
                  <div><strong>Credit Note:</strong> {creditNoteReceipt.returnNo}</div>
                  <div><strong>Date:</strong> {creditNoteReceipt.returnDate || new Date().toLocaleDateString("en-IN")}</div>
                  {creditNoteReceipt.originalInvoiceNo && (
                    <div><strong>Against Bill:</strong> {creditNoteReceipt.originalInvoiceNo}</div>
                  )}
                </div>
                <div className="text-right">
                  <div><strong>Customer:</strong> {creditNoteReceipt.customerName}</div>
                  {creditNoteReceipt.customerPhone && (
                    <div><strong>Phone:</strong> {creditNoteReceipt.customerPhone}</div>
                  )}
                  <div><strong>Mode:</strong> {creditNoteReceipt.refundMode === "credit" ? "Account Credit" : "Cash Tender"}</div>
                </div>
              </div>

              {/* Items Table */}
              <div className="py-2 border-b border-slate-200">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-300 font-semibold text-slate-700">
                      <th className="text-left pb-1">Returned Item</th>
                      <th className="text-center pb-1">Qty</th>
                      <th className="text-right pb-1">Rate</th>
                      <th className="text-right pb-1">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {creditNoteReceipt.items.map((l: any, i: number) => (
                      <tr key={i}>
                        <td className="py-1">
                          <div className="font-semibold">{l.itemName}</div>
                          <div className="text-[9px] text-slate-500 font-mono">
                            Batch {l.batchNo} · Exp {l.expiryDate} · {l.disposition === "restock" ? "Restocked" : "Damaged"}
                          </div>
                        </td>
                        <td className="py-1 text-center font-mono">{l.qtyBase}</td>
                        <td className="py-1 text-right font-mono">{formatINR(l.ratePaise)}</td>
                        <td className="py-1 text-right font-mono font-bold">
                          {formatINR(Math.round(l.qtyBase * l.ratePaise))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="py-3 flex flex-col gap-1 text-right text-xs">
                <div>Taxable Value: <span className="font-mono">{formatINR(creditNoteReceipt.subtotalPaise)}</span></div>
                <div>GST Reversal (12%): <span className="font-mono">{formatINR(creditNoteReceipt.taxPaise)}</span></div>
                <div className="text-sm font-bold font-mono text-navy-900 pt-1.5 border-t border-slate-300 flex justify-between">
                  <span>NET REFUND:</span>
                  <span>{formatINR(creditNoteReceipt.totalPaise)}</span>
                </div>
              </div>

              {/* Refund Method Banner */}
              <div className="p-2 rounded bg-slate-50 border border-slate-200 text-center text-[11px] font-semibold">
                {creditNoteReceipt.refundMode === "credit"
                  ? "AMOUNT CREDITED TO CUSTOMER ACCOUNT LEDGER BALANCE"
                  : "CASH TENDER REFUND PAID TO CUSTOMER"}
              </div>

              {/* Compliance Note & Signatory */}
              <div className="pt-3 border-t border-slate-200 mt-2 text-[9px] text-slate-500 text-center">
                <div>Issued under Drugs & Cosmetics Rules 1945. Returned items inspected for seal integrity.</div>
                <div className="mt-4 pt-1 border-t border-slate-300 inline-block px-6">
                  Pharmacist Signatory (Rahul Sharma, B.Pharm)
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-200 no-print">
              <button
                onClick={() => setCreditNoteReceipt(null)}
                className="px-4 py-1.5 text-xs font-semibold rounded border border-slate-200 text-slate-700"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded bg-teal-600 hover:bg-teal-700 text-white"
              >
                <Printer className="w-3.5 h-3.5 stroke-[2]" />
                <span>Print Credit Note</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
