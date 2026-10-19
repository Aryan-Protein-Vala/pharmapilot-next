"use client";

import React, { useState, useEffect } from "react";
import {
  Truck,
  Plus,
  Trash2,
  Receipt,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileText,
  Calendar,
  Building,
  RefreshCw,
  RotateCcw,
  Printer,
  X,
  Search,
  Layers,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR, paiseToRupeesStr, rupeesToPaise } from "@/lib/money";

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

interface AvailableBatch {
  batchId: string;
  itemId: string;
  itemName: string;
  batchNo: string;
  expiryDate: string;
  mrpPaise: number;
  ptrPaise: number;
  purchaseRatePaise: number;
  currentQtyBase: number;
  gstRateBp: number;
}

interface ReturnLine {
  id: string;
  batchId: string;
  itemId: string;
  itemName: string;
  batchNo: string;
  expiryDate: string;
  stockAvailable: number;
  qtyBase: number;
  ratePaise: number;
  gstRateBp: number;
  taxablePaise: number;
  taxPaise: number;
  lineTotalPaise: number;
}

interface PurchaseReturnRecord {
  id: string;
  returnNo: string;
  returnDate: string;
  supplierId: string;
  supplierName: string;
  supplierGstin: string;
  supplierPhone: string;
  originalPurchaseId: string | null;
  reason: string;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  itemCount: number;
  createdAt: string;
  items: any[];
}

export default function PurchasesPage() {
  const { success, warning, error, info } = useToast();

  const [activeTab, setActiveTab] = useState<"inward" | "returns">("inward");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<RecentPurchase[]>([]);
  const [availableBatches, setAvailableBatches] = useState<AvailableBatch[]>([]);
  const [loading, setLoading] = useState(true);

  // Inward Form State
  const [supplierId, setSupplierId] = useState("");
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMode, setPaymentMode] = useState<"credit" | "cash" | "upi">("credit");
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [selectedItemId, setSelectedItemId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Alphanumeric Search for 2.5L+ Medicine Master Catalog
  const [medSearchQuery, setMedSearchQuery] = useState("");
  const [medSearchResults, setMedSearchResults] = useState<any[]>([]);
  const [isSearchingMed, setIsSearchingMed] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);

  // Purchase Returns (Debit Notes) State
  const [returnsList, setReturnsList] = useState<PurchaseReturnRecord[]>([]);
  const [loadingReturns, setLoadingReturns] = useState(false);
  const [returnSupplierId, setReturnSupplierId] = useState("");
  const [returnOriginalInvoice, setReturnOriginalInvoice] = useState("");
  const [returnReason, setReturnReason] = useState("Expired Stock");
  const [returnLines, setReturnLines] = useState<ReturnLine[]>([]);
  const [selectedBatchForReturn, setSelectedBatchForReturn] = useState("");
  const [returnQtyInput, setReturnQtyInput] = useState<number>(10);
  const [returnRateRupees, setReturnRateRupees] = useState("");
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [printDebitNote, setPrintDebitNote] = useState<any | null>(null);

  const fetchPurchasesData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/purchases");
      if (res.ok) {
        const data = await res.json();
        setSuppliers(data.suppliers || []);
        setItems(data.items || []);
        setRecentPurchases(data.recentPurchases || []);
        if (data.availableBatches) {
          setAvailableBatches(
            data.availableBatches.map((b: any) => ({
              batchId: String(b.batch_id || b.batchId),
              itemId: String(b.item_id || b.itemId),
              itemName: String(b.item_name || b.itemName),
              batchNo: String(b.batch_no || b.batchNo),
              expiryDate: String(b.expiry_date || b.expiryDate),
              mrpPaise: Number(b.mrp_paise || b.mrpPaise),
              ptrPaise: Number(b.ptr_paise || b.ptrPaise),
              purchaseRatePaise: Number(b.purchase_rate_paise || b.purchaseRatePaise),
              currentQtyBase: Number(b.current_qty_base || b.currentQtyBase),
              gstRateBp: Number(b.gst_rate_bp || b.gstRateBp),
            }))
          );
        }
        if (data.suppliers && data.suppliers.length > 0) {
          if (!supplierId) setSupplierId(data.suppliers[0].id);
          if (!returnSupplierId) setReturnSupplierId(data.suppliers[0].id);
        }
      }
    } catch (err) {
      console.error("Failed to load purchases catalog", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchReturnsData = async () => {
    try {
      setLoadingReturns(true);
      const res = await fetch("/api/purchases/returns");
      if (res.ok) {
        const data = await res.json();
        setReturnsList(data.returns || []);
        if (data.availableBatches) {
          setAvailableBatches(data.availableBatches);
        }
      }
    } catch (err) {
      console.error("Failed to load purchase returns", err);
    } finally {
      setLoadingReturns(false);
    }
  };

  useEffect(() => {
    fetchPurchasesData();
    fetchReturnsData();
  }, []);

  useEffect(() => {
    if (!medSearchQuery.trim()) {
      setMedSearchResults([]);
      setIsSearchingMed(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setIsSearchingMed(true);
        const res = await fetch(`/api/pos/search?q=${encodeURIComponent(medSearchQuery.trim())}&limit=15`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setMedSearchResults(data.results || data.items || []);
        }
      } catch (err: any) {
        if (err.name !== "AbortError") console.error(err);
      } finally {
        setIsSearchingMed(false);
      }
    }, 80);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [medSearchQuery]);

  const handleSelectSearchedItem = (item: any) => {
    const itemOption: ItemOption = {
      id: String(item.id),
      name: String(item.name),
      genericName: String(item.genericName || ""),
      baseUnit: String(item.baseUnit || "TAB"),
      saleUnit: String(item.saleUnit || item.baseUnit || "STRIP"),
      packSize: Number(item.packSize || 1),
      gstRateBp: Number(item.gstRateBp || 1200),
    };
    setItems((prev) => {
      if (prev.some((i) => i.id === itemOption.id)) return prev;
      return [...prev, itemOption];
    });
    addLine(itemOption);
    setMedSearchQuery("");
    setShowSearchDropdown(false);
  };

  const addLine = (itemOrIdToAdd?: string | ItemOption) => {
    let itm: ItemOption | undefined;
    if (typeof itemOrIdToAdd === "object" && itemOrIdToAdd) {
      itm = itemOrIdToAdd;
    } else {
      const id = (typeof itemOrIdToAdd === "string" ? itemOrIdToAdd : selectedItemId) || items[0]?.id;
      itm = items.find((i) => i.id === id);
    }
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
    const marginPct = mrpPaise > 0 ? ((mrpPaise - effCostPerPackPaise) / mrpPaise) * 100 : 0;

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

  const subtotalPaise = computedLines.reduce((s, l) => s + l.taxablePaise, 0);
  const totalTaxPaise = computedLines.reduce((s, l) => s + l.taxPaise, 0);
  const rawTotalPaise = subtotalPaise + totalTaxPaise;
  const grandTotalPaise = Math.round(rawTotalPaise / 100) * 100;
  const roundOffPaise = grandTotalPaise - rawTotalPaise;

  const handleSubmitInward = async () => {
    if (!supplierInvoiceNo.trim()) {
      warning("Invoice No Missing", "Please enter the supplier invoice number.");
      return;
    }
    if (lines.length === 0) {
      warning("No Items", "Please add at least one line item to the inward purchase bill.");
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        supplierId,
        supplierInvoiceNo: supplierInvoiceNo.trim(),
        invoiceDate,
        paymentMode,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          batchNo: l.batchNo.trim(),
          expiryDate: l.expiryDate,
          billedBase: l.qtyPacks,
          freeBase: l.freePacks,
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
      fetchReturnsData();
    } catch (err: any) {
      error("Purchase Error", err.message || "Failed to post purchase entry.");
    } finally {
      setSubmitting(false);
    }
  };

  // Add Item to Purchase Return
  const handleAddReturnLine = () => {
    const batch = availableBatches.find((b) => b.batchId === selectedBatchForReturn);
    if (!batch) {
      warning("Batch Required", "Please select an expired or returnable batch from stock.");
      return;
    }
    if (returnQtyInput <= 0) {
      warning("Invalid Qty", "Return quantity must be greater than zero.");
      return;
    }
    if (returnQtyInput > batch.currentQtyBase) {
      warning(
        "Insufficient Stock",
        `Only ${batch.currentQtyBase} units available in stock for batch ${batch.batchNo}.`
      );
      return;
    }

    const ratePaise = returnRateRupees
      ? rupeesToPaise(returnRateRupees)
      : batch.purchaseRatePaise || batch.ptrPaise;
    const taxablePaise = returnQtyInput * ratePaise;
    const taxPaise = Math.round((taxablePaise * batch.gstRateBp) / 10000);
    const lineTotalPaise = taxablePaise + taxPaise;

    const newLine: ReturnLine = {
      id: `retline_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      batchId: batch.batchId,
      itemId: batch.itemId,
      itemName: batch.itemName,
      batchNo: batch.batchNo,
      expiryDate: batch.expiryDate,
      stockAvailable: batch.currentQtyBase,
      qtyBase: returnQtyInput,
      ratePaise,
      gstRateBp: batch.gstRateBp,
      taxablePaise,
      taxPaise,
      lineTotalPaise,
    };

    setReturnLines((prev) => [...prev, newLine]);
    setSelectedBatchForReturn("");
    setReturnRateRupees("");
    setReturnQtyInput(10);
  };

  const handlePostPurchaseReturn = async () => {
    if (!returnSupplierId) {
      warning("Supplier Missing", "Please select the distributor for this debit note.");
      return;
    }
    if (returnLines.length === 0) {
      warning("No Items", "Please add at least one batch line to the purchase return.");
      return;
    }

    try {
      setSubmittingReturn(true);
      const payload = {
        supplierId: returnSupplierId,
        originalInvoiceNo: returnOriginalInvoice.trim() || undefined,
        reason: returnReason,
        items: returnLines.map((l) => ({
          itemId: l.itemId,
          batchId: l.batchId,
          qtyBase: l.qtyBase,
          ratePaise: l.ratePaise,
        })),
      };

      const res = await fetch("/api/purchases/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to process purchase return");
      }

      const result = await res.json();
      success(
        "Debit Note Issued",
        `Debit Note #${result.returnNo} generated for ${result.supplierName}. Stock deducted.`
      );

      // Open print modal
      setPrintDebitNote({
        ...result,
        supplierGstin: suppliers.find((s) => s.id === returnSupplierId)?.gstin || "",
        supplierPhone: suppliers.find((s) => s.id === returnSupplierId)?.phone || "",
        reason: returnReason,
      });

      // Clear form
      setReturnLines([]);
      setReturnOriginalInvoice("");
      fetchReturnsData();
      fetchPurchasesData();
    } catch (err: any) {
      error("Return Error", err.message || "Failed to issue purchase return.");
    } finally {
      setSubmittingReturn(false);
    }
  };

  const returnSubtotalPaise = returnLines.reduce((s, l) => s + l.taxablePaise, 0);
  const returnTaxPaise = returnLines.reduce((s, l) => s + l.taxPaise, 0);
  const returnTotalPaise = returnSubtotalPaise + returnTaxPaise;

  const totalReturnNotesCount = returnsList.length;
  const totalReturnedValuePaise = returnsList.reduce((s, r) => s + r.totalPaise, 0);

  return (
    <div className="space-y-4 max-w-7xl mx-auto select-none">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              Distributor Purchases & Expiry Returns
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              B2B Stockist Engine
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Inward billing with 10+2 bonus schemes, automated stock deduction for expired returns, and debit notes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchPurchasesData();
              fetchReturnsData();
            }}
            disabled={loading || loadingReturns}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                loading || loadingReturns ? "animate-spin text-teal-600" : "text-slate-500"
              }`}
            />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-navy-800">
        <button
          onClick={() => setActiveTab("inward")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "inward"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Truck className="w-3.5 h-3.5 stroke-[2]" />
          <span>Purchase Inward (10+2 Scheme)</span>
        </button>

        <button
          onClick={() => setActiveTab("returns")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "returns"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5 stroke-[2]" />
          <span>Purchase Returns (Distributor Debit Notes)</span>
          {totalReturnNotesCount > 0 && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-800 font-mono">
              {totalReturnNotesCount}
            </span>
          )}
        </button>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: PURCHASE INWARD                                               */}
      {/* ==================================================================== */}
      {activeTab === "inward" && (
        <div className="space-y-4">
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
                  className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Payment Mode
                </label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value as any)}
                  className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium"
                >
                  <option value="credit">Credit (Stockist Udhar)</option>
                  <option value="cash">Cash Paid</option>
                  <option value="upi">UPI / Bank Transfer</option>
                </select>
              </div>
            </div>
          </div>

          {/* Quick Line Adder */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 p-3 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm relative">
            <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {/* Alphanumeric Instant Search Input for 2.5 Lakh Medicine Master */}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search 2.5L+ medicines (e.g. Dolo, Augmentin)..."
                  value={medSearchQuery}
                  onChange={(e) => {
                    setMedSearchQuery(e.target.value);
                    setShowSearchDropdown(true);
                  }}
                  onFocus={() => {
                    if (medSearchQuery.trim()) setShowSearchDropdown(true);
                  }}
                  className="w-full h-8 pl-8 pr-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-xs font-medium placeholder:text-slate-400 focus:outline-none focus:border-teal-500"
                />
                {showSearchDropdown && medSearchResults.length > 0 && (
                  <div className="absolute left-0 top-full mt-1 w-full max-h-64 overflow-y-auto bg-white dark:bg-navy-900 border border-slate-200 dark:border-navy-700 rounded-md shadow-xl z-50 divide-y divide-slate-100 dark:divide-navy-800">
                    {medSearchResults.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => handleSelectSearchedItem(item)}
                        className="p-2.5 hover:bg-slate-50 dark:hover:bg-navy-800 cursor-pointer flex flex-col text-left transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-navy-900 dark:text-slate-100">{item.name}</span>
                          <span className="text-[10px] text-teal-600 dark:text-teal-400 font-medium">
                            {item.packSize} {item.baseUnit}
                          </span>
                        </div>
                        {item.genericName && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {item.genericName}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <span className="text-[11px] text-slate-400 font-medium hidden sm:inline px-1">or</span>

              {/* Fast Select of Top Medicines */}
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-xs font-semibold max-w-xs focus:outline-none focus:border-teal-500"
              >
                <option value="">Select formulation...</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.packSize} {i.baseUnit})
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => addLine()}
                disabled={!selectedItemId && items.length === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-xs transition-colors shrink-0 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Add Line</span>
              </button>
            </div>

            <button
              onClick={handleSubmitInward}
              disabled={submitting || lines.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors disabled:opacity-50 shrink-0"
            >
              <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
              <span>Post Inward Invoice</span>
            </button>
          </div>

          {/* Purchase Inward Table */}
          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
                Inward Batch Line Items ({lines.length})
              </span>
              <span className="text-[10px] text-slate-400">
                Tax calculated strictly on Billed packs; Stock increments by (Billed + Free)
              </span>
            </div>

            {lines.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                No items added. Select a medicine above and click Add Item Line.
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="py-2 px-3">Item Description</th>
                    <th className="py-2 px-2">Batch #</th>
                    <th className="py-2 px-2">Expiry Date</th>
                    <th className="py-2 px-2 text-right">Billed Packs</th>
                    <th className="py-2 px-2 text-right">Free Bonus</th>
                    <th className="py-2 px-2 text-right">PTR (₹)</th>
                    <th className="py-2 px-2 text-right">MRP (₹)</th>
                    <th className="py-2 px-2 text-center">GST %</th>
                    <th className="py-2 px-2 text-right">Margin %</th>
                    <th className="py-2 px-3 text-right">Line Total (₹)</th>
                    <th className="py-2 px-2 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                  {computedLines.map((line) => (
                    <tr key={line.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                      <td className="py-2 px-3">
                        <div className="font-semibold text-navy-900 dark:text-slate-100">{line.itm?.name}</div>
                        <div className="text-[10px] text-slate-400">{line.itm?.genericName}</div>
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          value={line.batchNo}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLines((prev) =>
                              prev.map((l, i) => (i === line.idx ? { ...l, batchNo: val } : l))
                            );
                          }}
                          className="w-20 h-7 px-1.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono text-xs uppercase"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="date"
                          value={line.expiryDate}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLines((prev) =>
                              prev.map((l, i) => (i === line.idx ? { ...l, expiryDate: val } : l))
                            );
                          }}
                          className="w-28 h-7 px-1.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono text-xs"
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <input
                          type="number"
                          min="1"
                          value={line.qtyPacks}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setLines((prev) =>
                              prev.map((l, i) => (i === line.idx ? { ...l, qtyPacks: val } : l))
                            );
                          }}
                          className="w-14 h-7 px-1.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono text-xs text-right"
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <input
                          type="number"
                          min="0"
                          value={line.freePacks}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setLines((prev) =>
                              prev.map((l, i) => (i === line.idx ? { ...l, freePacks: val } : l))
                            );
                          }}
                          className="w-12 h-7 px-1.5 rounded border border-slate-200 dark:border-navy-700 bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 font-mono text-xs text-right font-bold"
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <input
                          type="text"
                          value={line.ptrRupees}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLines((prev) =>
                              prev.map((l, i) => (i === line.idx ? { ...l, ptrRupees: val } : l))
                            );
                          }}
                          className="w-16 h-7 px-1.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono text-xs text-right"
                        />
                      </td>
                      <td className="py-2 px-2 text-right">
                        <input
                          type="text"
                          value={line.mrpRupees}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLines((prev) =>
                              prev.map((l, i) => (i === line.idx ? { ...l, mrpRupees: val } : l))
                            );
                          }}
                          className="w-16 h-7 px-1.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono text-xs text-right"
                        />
                      </td>
                      <td className="py-2 px-2 text-center font-mono">
                        {(line.gstRateBp / 100).toFixed(0)}%
                      </td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-emerald-600">
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

            {/* Summary Box */}
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

          {/* Recent Inwards Log */}
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
      )}

      {/* ==================================================================== */}
      {/* TAB 2: PURCHASE RETURNS (DISTRIBUTOR DEBIT NOTES)                     */}
      {/* ==================================================================== */}
      {activeTab === "returns" && (
        <div className="space-y-4">
          {/* Top Return Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Debit Notes Issued
              </span>
              <div className="mt-1 text-xl font-bold font-mono text-teal-700 dark:text-teal-400 tabular-nums">
                {totalReturnNotesCount} Notes
              </div>
              <span className="text-[10px] text-slate-400">Distributor expiry returns</span>
            </div>

            <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Returned Value (Debit)
              </span>
              <div className="mt-1 text-xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">
                {formatINR(totalReturnedValuePaise)}
              </div>
              <span className="text-[10px] text-slate-400">Stockist balance debited</span>
            </div>

            <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Available Batches in Inventory
              </span>
              <div className="mt-1 text-xl font-bold font-mono text-navy-900 dark:text-slate-100 tabular-nums">
                {availableBatches.length} Batches
              </div>
              <span className="text-[10px] text-slate-400">Ready for return selection</span>
            </div>
          </div>

          {/* Create Return Section */}
          <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-navy-700">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-rose-600 stroke-[2]" />
                <h3 className="font-bold text-xs text-navy-900 dark:text-slate-100">
                  New Purchase Return & Distributor Debit Note
                </h3>
              </div>
              <span className="text-[11px] text-slate-400 font-mono">Deducts batch stock atomically</span>
            </div>

            {/* Header Form */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Distributor / Stockist *
                </label>
                <select
                  value={returnSupplierId}
                  onChange={(e) => setReturnSupplierId(e.target.value)}
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
                  Return Reason *
                </label>
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-teal-500"
                >
                  <option value="Expired Stock">Expired Stock (Distributor Return)</option>
                  <option value="Near-Expiry Return">Near-Expiry Return (&lt;3 Months)</option>
                  <option value="Damaged / Broken in Transit">Damaged / Broken in Transit</option>
                  <option value="Distributor Quality Recall">Distributor Quality Recall</option>
                  <option value="Wrong Item Supplied">Wrong Item Supplied</option>
                  <option value="Short Expiry Received">Short Expiry Received</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Original Purchase Invoice Ref (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. INV-9042 or PUR-0001"
                  value={returnOriginalInvoice}
                  onChange={(e) => setReturnOriginalInvoice(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-mono text-xs focus:outline-none focus:border-teal-500"
                />
              </div>
            </div>

            {/* Batch Selector & Line Adder */}
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-navy-900/60 border border-slate-200 dark:border-navy-700 space-y-3">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block uppercase">
                Select Batch to Return from Pharmacy Inventory:
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
                <div className="sm:col-span-2">
                  <label className="block text-[10px] text-slate-500 mb-1">Batch Option *</label>
                  <select
                    value={selectedBatchForReturn}
                    onChange={(e) => {
                      setSelectedBatchForReturn(e.target.value);
                      const b = availableBatches.find((item) => item.batchId === e.target.value);
                      if (b) {
                        setReturnRateRupees(paiseToRupeesStr(b.purchaseRatePaise || b.ptrPaise));
                      }
                    }}
                    className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-xs font-semibold focus:outline-none focus:border-teal-500"
                  >
                    <option value="">Choose Batch (Item Name · Batch # · Expiry · Stock)...</option>
                    {availableBatches.map((b) => (
                      <option key={b.batchId} value={b.batchId}>
                        {b.itemName} — Batch {b.batchNo} (Exp: {b.expiryDate}) — Stock: {b.currentQtyBase} Packs
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Return Qty (Packs) *</label>
                  <input
                    type="number"
                    min="1"
                    value={returnQtyInput}
                    onChange={(e) => setReturnQtyInput(parseInt(e.target.value) || 0)}
                    className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Return Rate (₹ PTR) *</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 70.00"
                      value={returnRateRupees}
                      onChange={(e) => setReturnRateRupees(e.target.value)}
                      className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleAddReturnLine}
                      className="px-3 h-8 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-xs flex items-center gap-1 transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      <span>Add</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Return Lines Table */}
            <div className="border border-slate-200 dark:border-navy-700 rounded-lg overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between text-xs">
                <span className="font-semibold text-navy-900 dark:text-slate-100">
                  Batches to Return ({returnLines.length})
                </span>
                <span className="text-[10px] text-slate-400">
                  Debit note generated will adjust distributor ledger
                </span>
              </div>

              {returnLines.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  No batches added to return yet. Select an expired or damaged batch above.
                </div>
              ) : (
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 uppercase font-semibold border-b border-slate-200 dark:border-navy-700">
                    <tr>
                      <th className="p-2.5">Medicine Name</th>
                      <th className="p-2.5">Batch #</th>
                      <th className="p-2.5">Expiry Date</th>
                      <th className="p-2.5 text-right">Return Qty</th>
                      <th className="p-2.5 text-right">Rate (₹)</th>
                      <th className="p-2.5 text-center">GST %</th>
                      <th className="p-2.5 text-right">Line Total (₹)</th>
                      <th className="p-2.5 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                    {returnLines.map((line) => (
                      <tr key={line.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750">
                        <td className="p-2.5 font-semibold text-navy-900 dark:text-slate-100">{line.itemName}</td>
                        <td className="p-2.5 font-mono">{line.batchNo}</td>
                        <td className="p-2.5 font-mono text-rose-600 font-medium">{line.expiryDate}</td>
                        <td className="p-2.5 text-right font-mono font-bold">{line.qtyBase} Packs</td>
                        <td className="p-2.5 text-right font-mono">{formatINR(line.ratePaise)}</td>
                        <td className="p-2.5 text-center font-mono">{(line.gstRateBp / 100).toFixed(0)}%</td>
                        <td className="p-2.5 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                          {formatINR(line.lineTotalPaise)}
                        </td>
                        <td className="p-2.5 text-center">
                          <button
                            onClick={() => setReturnLines((prev) => prev.filter((l) => l.id !== line.id))}
                            className="p-1 rounded text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Return Total & Submit Bar */}
              <div className="p-3.5 bg-slate-50 dark:bg-navy-900/40 border-t border-slate-200 dark:border-navy-700 flex flex-wrap items-center justify-between gap-4">
                <div className="text-xs font-mono flex items-center gap-4">
                  <div>Taxable: <strong className="text-slate-800 dark:text-slate-200">{formatINR(returnSubtotalPaise)}</strong></div>
                  <div>GST: <strong className="text-slate-800 dark:text-slate-200">{formatINR(returnTaxPaise)}</strong></div>
                  <div className="text-sm font-bold text-rose-600">
                    Debit Note Total: {formatINR(returnTotalPaise)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handlePostPurchaseReturn}
                  disabled={submittingReturn || returnLines.length === 0}
                  className="px-4 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RotateCcw className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Issue Distributor Debit Note & Deduct Stock</span>
                </button>
              </div>
            </div>
          </div>

          {/* Past Purchase Returns Registry */}
          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
                Purchase Returns & Debit Notes Issued ({returnsList.length})
              </span>
              <span className="text-[10px] text-slate-400 font-mono">B2B Return Log</span>
            </div>

            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 uppercase font-semibold border-b border-slate-200 dark:border-navy-700">
                <tr>
                  <th className="py-2.5 px-3">Debit Note #</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Distributor</th>
                  <th className="py-2.5 px-3">Reason</th>
                  <th className="py-2.5 px-2 text-center">Items</th>
                  <th className="py-2.5 px-3 text-right">Taxable</th>
                  <th className="py-2.5 px-3 text-right">GST</th>
                  <th className="py-2.5 px-3 text-right">Total Debit Value</th>
                  <th className="py-2.5 px-2 text-center">Print</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {returnsList.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      No purchase returns recorded yet. Issue your first debit note above.
                    </td>
                  </tr>
                ) : (
                  returnsList.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-medium text-rose-600 dark:text-rose-400">
                        {r.returnNo}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">{r.returnDate}</td>
                      <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">
                        {r.supplierName}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{r.reason}</td>
                      <td className="py-2.5 px-2 text-center font-mono">{r.itemCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatINR(r.subtotalPaise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatINR(r.taxPaise)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                        {formatINR(r.totalPaise)}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <button
                          onClick={() => setPrintDebitNote(r)}
                          className="p-1 rounded text-slate-500 hover:text-teal-600 transition-colors"
                          title="Print Debit Note"
                        >
                          <Printer className="w-3.5 h-3.5 stroke-[2]" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: PRINTABLE DISTRIBUTOR DEBIT NOTE                               */}
      {/* ==================================================================== */}
      {printDebitNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl border border-slate-200 text-slate-900 font-sans max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-start pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-bold tracking-tight uppercase text-navy-900">
                  DISTRIBUTOR DEBIT NOTE / PURCHASE RETURN
                </h3>
                <p className="text-xs text-slate-600 font-semibold mt-0.5">PharmaPilot Wellness Pharmacy</p>
                <p className="text-[11px] text-slate-500">
                  GSTIN: 29AABCU9603R1ZM · DL: KA-B1-2024-00123
                </p>
              </div>
              <div className="text-right">
                <span className="inline-block px-2.5 py-1 rounded bg-rose-50 border border-rose-200 text-rose-700 text-xs font-mono font-bold">
                  {printDebitNote.returnNo}
                </span>
                <span className="block text-[11px] text-slate-500 mt-1 font-mono">
                  Date: {printDebitNote.returnDate}
                </span>
              </div>
            </div>

            {/* To Distributor Details */}
            <div className="my-4 p-3 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-2 gap-4 text-xs font-sans">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-semibold">To Distributor:</span>
                <div className="font-bold text-slate-800 text-sm">{printDebitNote.supplierName}</div>
                <div className="text-slate-500 font-mono text-[11px]">
                  GSTIN: {printDebitNote.supplierGstin || "Unregistered"}
                </div>
                {printDebitNote.supplierPhone && (
                  <div className="text-slate-500 text-[11px]">Ph: {printDebitNote.supplierPhone}</div>
                )}
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase font-semibold">Return Particulars:</span>
                <div className="font-semibold text-slate-700 mt-0.5">Reason: {printDebitNote.reason}</div>
                {printDebitNote.originalPurchaseId && (
                  <div className="text-slate-500 font-mono text-[11px]">
                    Against Invoice: {printDebitNote.originalPurchaseId}
                  </div>
                )}
              </div>
            </div>

            {/* Itemized Table */}
            <div className="border border-slate-200 rounded-lg overflow-hidden my-4">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 uppercase font-semibold border-b border-slate-200">
                  <tr>
                    <th className="p-2">Item Description</th>
                    <th className="p-2">Batch #</th>
                    <th className="p-2">Expiry</th>
                    <th className="p-2 text-right">Return Qty</th>
                    <th className="p-2 text-right">Rate (₹)</th>
                    <th className="p-2 text-center">GST %</th>
                    <th className="p-2 text-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {(printDebitNote.lines || printDebitNote.items || []).map((l: any, i: number) => (
                    <tr key={i}>
                      <td className="p-2 font-sans font-semibold text-slate-900">{l.itemName || l.item_name}</td>
                      <td className="p-2">{l.batchNo || l.batch_no}</td>
                      <td className="p-2 text-rose-600">{l.expiryDate || l.expiry_date}</td>
                      <td className="p-2 text-right font-bold">{l.qtyBase || l.qty_base} Packs</td>
                      <td className="p-2 text-right">{formatINR(l.ratePaise || l.rate_paise)}</td>
                      <td className="p-2 text-center">{((l.gstRateBp || 1200) / 100).toFixed(0)}%</td>
                      <td className="p-2 text-right font-bold">{formatINR(l.lineTotalPaise || l.line_total_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals Breakdown */}
            <div className="flex justify-end my-3">
              <div className="w-64 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Taxable Subtotal:</span>
                  <span>{formatINR(printDebitNote.subtotalPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">GST Total:</span>
                  <span>{formatINR(printDebitNote.taxPaise)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200 font-bold text-sm text-rose-600">
                  <span>Total Debit Amount:</span>
                  <span>{formatINR(printDebitNote.totalPaise)}</span>
                </div>
              </div>
            </div>

            {/* Note & Signatures */}
            <div className="p-3 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-800 font-sans">
              Notice to Distributor: The above mentioned expired / damaged medicines have been deducted from pharmacy inventory and your supplier ledger account has been debited by {formatINR(printDebitNote.totalPaise)}. Please adjust against upcoming invoices or issue a credit adjustment note.
            </div>

            <div className="mt-8 pt-4 border-t border-slate-200 grid grid-cols-2 gap-8 text-[11px] text-slate-500 text-center font-sans">
              <div>
                <div className="border-b border-slate-300 h-8 mb-1"></div>
                <span>Authorized Pharmacist Sign & Stamp</span>
              </div>
              <div>
                <div className="border-b border-slate-300 h-8 mb-1"></div>
                <span>Distributor Receiver / Logistics Sign</span>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setPrintDebitNote(null)}
                className="px-3.5 py-1.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-medium"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-sm flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Debit Note</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
