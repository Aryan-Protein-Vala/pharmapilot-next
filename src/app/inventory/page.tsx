"use client";

import React, { useState, useEffect } from "react";
import {
  Package,
  AlertTriangle,
  Clock,
  Layers,
  Search,
  Filter,
  Plus,
  ArrowUpDown,
  History,
  Trash2,
  X,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/money";
import { formatSmartStock } from "@/lib/units";

interface BatchInfo {
  batchId: string;
  batchNo: string;
  expiryDate: string;
  daysLeft: number;
  mrpPaise: number;
  ptrPaise: number;
  stockBase: number;
}

interface StockItem {
  id: string;
  name: string;
  genericName: string;
  manufacturer: string;
  rackLocation: string;
  schedule: string;
  baseUnit: string;
  saleUnit: string;
  packSize: number;
  nearestExpiry: string;
  currentStockBase: number;
  costValuationPaise: number;
  mrpValuationPaise: number;
  batches: BatchInfo[];
}

interface Movement {
  id: string;
  created_at: string;
  qty_base_signed: number;
  movement_type: string;
  ref_doc_id: string;
  item_name: string;
  batch_no: string;
  base_unit: string;
}

export default function InventoryPage() {
  const { success, warning, error, info } = useToast();

  const [stockGrid, setStockGrid] = useState<StockItem[]>([]);
  const [grandCostPaise, setGrandCostPaise] = useState(0);
  const [grandMrpPaise, setGrandMrpPaise] = useState(0);
  const [recentMovements, setRecentMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Tabs
  const [activeTab, setActiveTab] = useState<"stock" | "expiry" | "ledger">("stock");
  const [expiryWindow, setExpiryWindow] = useState<"all" | "30" | "60" | "90" | "expired">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Adjustment Modal
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustBatchId, setAdjustBatchId] = useState("");
  const [adjustType, setAdjustType] = useState<"adjustment" | "damage" | "expiry_writeoff">("adjustment");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [submittingAdjust, setSubmittingAdjust] = useState(false);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/inventory");
      if (res.ok) {
        const data = await res.json();
        setStockGrid(data.stockGrid || []);
        setGrandCostPaise(data.grandCostPaise || 0);
        setGrandMrpPaise(data.grandMrpPaise || 0);
        setRecentMovements(data.recentMovements || []);
      }
    } catch (err) {
      console.error("Failed to fetch inventory", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustBatchId) {
      warning("Select Batch", "Please select a medicine batch to adjust.");
      return;
    }
    const rawQty = parseInt(adjustQty, 10);
    if (isNaN(rawQty) || rawQty === 0) {
      warning("Invalid Quantity", "Quantity must be non-zero.");
      return;
    }

    const qtySigned = adjustType === "damage" || adjustType === "expiry_writeoff" ? -Math.abs(rawQty) : rawQty;

    setSubmittingAdjust(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: adjustBatchId,
          qtySigned,
          movementType: adjustType,
          reason: adjustReason.trim() || `Manual ${adjustType}`,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Adjustment failed");
      }

      success("Stock Adjusted", "Immutable stock movement record created.");
      setShowAdjustModal(false);
      setAdjustQty("");
      setAdjustReason("");
      fetchInventory();
    } catch (err: any) {
      error("Error", err.message || "Failed to adjust stock.");
    } finally {
      setSubmittingAdjust(false);
    }
  };

  // Filtered Stock Grid
  const filteredStock = stockGrid.filter((item) => {
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const matchesSearch =
        item.name.toLowerCase().includes(q) ||
        item.genericName.toLowerCase().includes(q) ||
        item.manufacturer.toLowerCase().includes(q) ||
        item.rackLocation.toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }
    return true;
  });

  // Flat Batches for Expiry Radar
  const allActiveBatches = stockGrid.flatMap((item) =>
    item.batches.map((b) => ({
      ...b,
      medicineName: item.name,
      baseUnit: item.baseUnit,
      saleUnit: item.saleUnit,
      packSize: item.packSize,
      rackLocation: item.rackLocation,
    }))
  );

  const filteredBatches = allActiveBatches
    .filter((b) => {
      if (b.stockBase <= 0) return false;
      if (expiryWindow === "expired") return b.daysLeft < 0;
      if (expiryWindow === "30") return b.daysLeft >= 0 && b.daysLeft <= 30;
      if (expiryWindow === "60") return b.daysLeft >= 0 && b.daysLeft <= 60;
      if (expiryWindow === "90") return b.daysLeft >= 0 && b.daysLeft <= 90;
      return true;
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);

  return (
    <div className="space-y-4 max-w-7xl mx-auto select-none">
      {/* Top Header & Valuation Cards */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              Inventory & Batch Tracking
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              Live Movements
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time stock ledger derived from immutable stock movements with FEFO expiry monitoring.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchInventory}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-teal-600" : "text-slate-500"}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={() => setShowAdjustModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Stock Adjustment</span>
          </button>
        </div>
      </div>

      {/* Valuation & Metric Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Valuation @ Cost (PTR)
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-navy-900 dark:text-slate-100 tabular-nums">
            {formatINR(grandCostPaise)}
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Valuation @ Retail (MRP)
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-teal-700 dark:text-teal-400 tabular-nums">
            {formatINR(grandMrpPaise)}
          </div>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Active Catalog Items
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-navy-900 dark:text-slate-100 tabular-nums">
            {stockGrid.length} SKUs
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-navy-800">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("stock")}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "stock"
                ? "border-teal-600 text-teal-700 dark:text-teal-400"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            Real-Time Stock Grid
          </button>
          <button
            onClick={() => setActiveTab("expiry")}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "expiry"
                ? "border-teal-600 text-teal-700 dark:text-teal-400"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Clock className="w-3.5 h-3.5 stroke-[2]" />
            <span>Expiry Radar</span>
          </button>
          <button
            onClick={() => setActiveTab("ledger")}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "ledger"
                ? "border-teal-600 text-teal-700 dark:text-teal-400"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <History className="w-3.5 h-3.5 stroke-[2]" />
            <span>Stock Ledger</span>
          </button>
        </div>

        {/* Search input */}
        <div className="relative w-64 pb-1">
          <input
            type="text"
            placeholder="Filter medicine or rack..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 focus:outline-none focus:border-teal-500"
          />
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
        </div>
      </div>

      {/* Tab 1: Stock Grid */}
      {activeTab === "stock" && (
        <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Medicine & Salt</th>
                  <th className="py-2.5 px-3">Manufacturer</th>
                  <th className="py-2.5 px-2 text-center">Rack</th>
                  <th className="py-2.5 px-2 text-center">Nearest Exp</th>
                  <th className="py-2.5 px-3 text-right">Current Stock (Smart Units)</th>
                  <th className="py-2.5 px-3 text-right">Cost (PTR)</th>
                  <th className="py-2.5 px-3 text-right">Retail (MRP)</th>
                  <th className="py-2.5 px-3 text-center">Batches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {filteredStock.map((item) => {
                  const smartStockStr = formatSmartStock(item.currentStockBase, item.baseUnit, {
                    unitName: item.saleUnit,
                    qtyInBaseUnit: item.packSize,
                  });

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-navy-900 dark:text-slate-100">{item.name}</div>
                        <div className="text-[10px] text-slate-400">{item.genericName}</div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{item.manufacturer}</td>
                      <td className="py-2.5 px-2 text-center font-mono font-medium text-slate-700 dark:text-slate-300">
                        {item.rackLocation}
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                        {item.nearestExpiry}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                        {smartStockStr}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300">
                        {formatINR(item.costValuationPaise)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-teal-700 dark:text-teal-400">
                        {formatINR(item.mrpValuationPaise)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 dark:bg-navy-700 text-slate-700 dark:text-slate-300">
                          {item.batches.length} Batches
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Expiry Radar with 30/60/90 Day Filters */}
      {activeTab === "expiry" && (
        <div className="space-y-3">
          {/* Muted Amber Filter Tokens */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Expiry Window:</span>
            {[
              { key: "all", label: "All Active Batches" },
              { key: "expired", label: "Expired (< 0d)" },
              { key: "30", label: "< 30 Days" },
              { key: "60", label: "< 60 Days" },
              { key: "90", label: "< 90 Days" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setExpiryWindow(tab.key as any)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  expiryWindow === tab.key
                    ? "bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 font-semibold"
                    : "bg-white dark:bg-navy-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-navy-700 hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Medicine</th>
                  <th className="py-2.5 px-3">Batch No</th>
                  <th className="py-2.5 px-3">Expiry Date</th>
                  <th className="py-2.5 px-2 text-center">Days Remaining</th>
                  <th className="py-2.5 px-3 text-right">Available Stock</th>
                  <th className="py-2.5 px-3 text-right">At-Risk Cost (PTR)</th>
                  <th className="py-2.5 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                {filteredBatches.map((b) => (
                  <tr key={b.batchId} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">
                      {b.medicineName}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-medium text-slate-700 dark:text-slate-300">
                      {b.batchNo}
                    </td>
                    <td className="py-2.5 px-3 font-mono">{b.expiryDate}</td>
                    <td className="py-2.5 px-2 text-center font-mono">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          b.daysLeft < 0
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                            : b.daysLeft <= 60
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-slate-100 text-slate-700 dark:bg-navy-700 dark:text-slate-300"
                        }`}
                      >
                        {b.daysLeft < 0 ? "EXPIRED" : `${b.daysLeft}d left`}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">
                      {b.stockBase} {b.baseUnit}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {formatINR(Math.round((b.ptrPaise / b.packSize) * b.stockBase))}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => {
                          setAdjustBatchId(b.batchId);
                          setAdjustType(b.daysLeft < 0 ? "expiry_writeoff" : "damage");
                          setAdjustQty(String(b.stockBase));
                          setAdjustReason(`Expiry writeoff for Batch ${b.batchNo}`);
                          setShowAdjustModal(true);
                        }}
                        className="px-2 py-1 text-[11px] font-medium rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                      >
                        Write Off
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Immutable Stock Movements Ledger */}
      {activeTab === "ledger" && (
        <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30">
            <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
              Audit Stock Ledger (Immutable stock_movements)
            </span>
          </div>

          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Medicine</th>
                <th className="py-2.5 px-2 text-center">Batch</th>
                <th className="py-2.5 px-2 text-center">Movement Type</th>
                <th className="py-2.5 px-3 text-right">Qty (Base)</th>
                <th className="py-2.5 px-3">Doc Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
              {recentMovements.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                    {m.created_at.replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">
                    {m.item_name}
                  </td>
                  <td className="py-2.5 px-2 text-center font-mono">{m.batch_no}</td>
                  <td className="py-2.5 px-2 text-center">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase font-mono ${
                        m.qty_base_signed > 0
                          ? "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300"
                          : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                      }`}
                    >
                      {m.movement_type}
                    </span>
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono font-bold ${
                      m.qty_base_signed > 0 ? "text-teal-700 dark:text-teal-400" : "text-rose-700 dark:text-rose-400"
                    }`}
                  >
                    {m.qty_base_signed > 0 ? `+${m.qty_base_signed}` : m.qty_base_signed} {m.base_unit}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-500">{m.ref_doc_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-slate-200 dark:border-navy-700 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-800">
              <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                Record Stock Adjustment
              </h3>
              <button onClick={() => setShowAdjustModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4 stroke-[2]" />
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Medicine Batch *
                </label>
                <select
                  value={adjustBatchId}
                  onChange={(e) => setAdjustBatchId(e.target.value)}
                  required
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800 font-mono"
                >
                  <option value="">Select batch...</option>
                  {allActiveBatches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {b.medicineName} · Batch {b.batchNo} (Available: {b.stockBase} {b.baseUnit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Adjustment Type *
                </label>
                <select
                  value={adjustType}
                  onChange={(e: any) => setAdjustType(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800"
                >
                  <option value="adjustment">Physical Count Variance (+/-)</option>
                  <option value="damage">Damage / Breakage (-)</option>
                  <option value="expiry_writeoff">Expiry Write-Off (-)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Quantity in Base Units (e.g. Tablets) *
                </label>
                <input
                  type="number"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  required
                  placeholder="e.g. 10"
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Reason / Audit Note
                </label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Shelf physical audit discrepancy"
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-navy-800 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-200 text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdjust}
                  className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
                >
                  Post Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
