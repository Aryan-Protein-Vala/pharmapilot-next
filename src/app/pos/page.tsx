"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  PauseCircle,
  PlayCircle,
  Printer,
  ShieldAlert,
  ArrowRightLeft,
  X,
  Check,
  User,
  Stethoscope,
  CreditCard,
  QrCode,
  FileText,
  AlertCircle,
  Layers,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR, paiseToRupeesStr, rupeesToPaise } from "@/lib/money";
import { daysUntilExpiry, isBatchExpired } from "@/lib/dates";
import { generateQrSvg, buildUpiUri } from "@/lib/qr";

interface CatalogItem {
  id: string;
  name: string;
  genericName: string;
  manufacturer: string;
  hsnCode: string;
  gstRateBp: number;
  schedule: string;
  baseUnit: string;
  rackLocation: string;
  barcode: string;
  saleUnit: string;
  packSize: number;
  totalStockBase: number;
  batches: Array<{
    id: string;
    itemId: string;
    batchNo: string;
    expiryDate: string;
    mrpPaise: number;
    ptrPaise: number;
    availableQtyBase: number;
  }>;
}

interface CartLine {
  id: string;
  itemId: string;
  batchId: string;
  unitMode: "pack" | "loose";
  qty: number;
  discountPct: number;
}

interface HeldBill {
  id: string;
  date: string;
  patientName: string;
  lines: CartLine[];
}

export default function PosBillingPage() {
  const { success, warning, error, info } = useToast();

  // Catalog and reference state
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [shop, setShop] = useState<any>({});
  const [loading, setLoading] = useState(true);

  // Bill header state
  const [customerId, setCustomerId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [patientAddress, setPatientAddress] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "card" | "credit">("cash");
  const [billDiscountRupees, setBillDiscountRupees] = useState("0");

  // Search & Cart state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCatalogItem, setSelectedCatalogItem] = useState<CatalogItem | null>(null);
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);

  // Modals / Drawers
  const [showBatchModalForLineIdx, setShowBatchModalForLineIdx] = useState<number | null>(null);
  const [substituteItem, setSubstituteItem] = useState<CatalogItem | null>(null);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [compliancePromptOpen, setCompliancePromptOpen] = useState(false);
  const [printModalData, setPrintModalData] = useState<any | null>(null);
  const [printFormat, setPrintFormat] = useState<"a4" | "80mm" | "58mm">("80mm");

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const barcodeBufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);

  // 1. Fetch POS catalog data
  const loadCatalog = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/pos");
      if (res.ok) {
        const data = await res.json();
        setCatalog(data.catalog || []);
        setCustomers(data.customers || []);
        setDoctors(data.doctors || []);
        setShop(data.shop || {});
        if (data.catalog && data.catalog.length > 0 && !selectedCatalogItem) {
          setSelectedCatalogItem(data.catalog[0]);
        }
      }
    } catch (err) {
      console.error("Failed to load POS catalog", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  // 2. Hardware Barcode Scanner Wedge Listener (<35ms keystroke interval)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside textarea or modal input unless it's pure high-speed barcode stream
      const now = Date.now();
      const gap = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      if (e.key === "Enter") {
        const buffered = barcodeBufferRef.current.trim();
        if (buffered.length >= 3) {
          // Barcode scanner terminated with Enter
          const matchedItem = catalog.find(
            (i) => i.barcode.toLowerCase() === buffered.toLowerCase() ||
                   i.batches.some((b) => b.batchNo.toLowerCase() === buffered.toLowerCase())
          );
          if (matchedItem) {
            addItemWithFEFO(matchedItem.id, 1, "pack");
            success("Barcode Scanned", `${matchedItem.name} added to cart via scanner.`);
            barcodeBufferRef.current = "";
            e.preventDefault();
            return;
          }
        }
        barcodeBufferRef.current = "";
      } else if (e.key.length === 1) {
        if (gap < 40) {
          // Rapid keystroke (<40ms) indicative of hardware barcode wedge
          barcodeBufferRef.current += e.key;
        } else {
          // Slow typing: reset buffer to current character
          barcodeBufferRef.current = e.key;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [catalog]);

  // Alphanumeric FTS search filter supporting prefix qty (e.g. 2*dolo)
  const cleanSearchTerm = searchQuery.replace(/^\d+\s*\*\s*/, "").trim().toLowerCase();
  const searchResults = cleanSearchTerm
    ? catalog.filter(
        (i) =>
          i.name.toLowerCase().includes(cleanSearchTerm) ||
          i.genericName.toLowerCase().includes(cleanSearchTerm) ||
          i.barcode.toLowerCase().includes(cleanSearchTerm) ||
          i.batches.some((b) => b.batchNo.toLowerCase().includes(cleanSearchTerm))
      )
    : catalog.slice(0, 10);

  // Multi-batch FEFO auto-split logic
  const addItemWithFEFO = (itemId: string, requestedUnits = 1, unitMode: "pack" | "loose" = "pack") => {
    const item = catalog.find((i) => i.id === itemId);
    if (!item) return;

    const multiplier = unitMode === "pack" ? item.packSize : 1;
    const reqBase = Math.max(1, Math.round(requestedUnits * multiplier));

    const todayIso = new Date().toISOString().slice(0, 10);
    const validBatches = item.batches
      .filter((b) => b.availableQtyBase > 0 && !isBatchExpired(b.expiryDate, todayIso))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

    if (validBatches.length === 0) {
      warning("Out of Stock", `${item.name} has no unexpired stock available. Opening salt substitutes.`);
      setSubstituteItem(item);
      return;
    }

    let remainingBase = reqBase;
    const newSlices: CartLine[] = [];

    for (const b of validBatches) {
      if (remainingBase <= 0) break;
      const takeBase = Math.min(b.availableQtyBase, remainingBase);
      const canPack = unitMode === "pack" && takeBase % multiplier === 0;
      newSlices.push({
        id: `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        itemId: item.id,
        batchId: b.id,
        unitMode: canPack ? "pack" : "loose",
        qty: canPack ? takeBase / multiplier : takeBase,
        discountPct: 0,
      });
      remainingBase -= takeBase;
    }

    if (remainingBase > 0) {
      warning("Partial Stock Allocated", `Only ${reqBase - remainingBase} of ${reqBase} ${item.baseUnit} available.`);
    }

    setCartLines((prev) => [...prev, ...newSlices]);
    if (newSlices.length > 1) {
      info("FEFO Auto-Split", `Quantity split across ${newSlices.length} batches to preserve shelf life.`);
    }

    setSelectedCatalogItem(item);
    setSearchQuery("");
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const raw = searchQuery.trim();
      if (!raw) return;

      let qty = 1;
      let term = raw;
      const match = raw.match(/^(\d+)\s*\*\s*(.+)$/);
      if (match) {
        qty = Math.max(1, parseInt(match[1], 10) || 1);
        term = match[2].trim();
      }

      const found = catalog.find(
        (i) =>
          i.name.toLowerCase().includes(term.toLowerCase()) ||
          i.genericName.toLowerCase().includes(term.toLowerCase()) ||
          i.barcode.toLowerCase() === term.toLowerCase()
      );

      if (found) {
        addItemWithFEFO(found.id, qty, "pack");
      } else {
        warning("Not Found", `No matching medicine found for "${term}"`);
      }
    }
  };

  // Cart calculations
  let hasRestrictedSchedule = false;
  const computedLines = cartLines.map((line, idx) => {
    const item = catalog.find((i) => i.id === line.itemId);
    const batch = item?.batches.find((b) => b.id === line.batchId);
    const packSize = item?.packSize || 1;
    const qtyBase = line.unitMode === "pack" ? line.qty * packSize : line.qty;

    const unitMrpPaise =
      line.unitMode === "pack"
        ? batch?.mrpPaise || 0
        : Math.round((batch?.mrpPaise || 0) / packSize);

    const grossPaise = Math.round(line.qty * unitMrpPaise);
    const discPaise = Math.round((grossPaise * (line.discountPct * 100)) / 10000);
    const lineTotalPaise = grossPaise - discPaise;
    const gstRateBp = item?.gstRateBp || 1200;
    const taxablePaise = Math.round((lineTotalPaise * 10000) / (10000 + gstRateBp));
    const taxPaise = lineTotalPaise - taxablePaise;

    if (item && ["H", "H1", "X", "NDPS"].includes(item.schedule)) {
      hasRestrictedSchedule = true;
    }

    return {
      ...line,
      idx,
      item,
      batch,
      packSize,
      qtyBase,
      unitMrpPaise,
      grossPaise,
      discPaise,
      taxablePaise,
      taxPaise,
      lineTotalPaise,
    };
  });

  const subtotalPaise = computedLines.reduce((sum, l) => sum + l.taxablePaise, 0);
  const taxPaise = computedLines.reduce((sum, l) => sum + l.taxPaise, 0);
  const exactTotalPaise = computedLines.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  const billDiscountPaise = rupeesToPaise(billDiscountRupees || "0");
  const netTotalPaise = Math.max(0, exactTotalPaise - billDiscountPaise);
  const roundRemainder = ((netTotalPaise % 100) + 100) % 100;
  const roundOffPaise = roundRemainder >= 50 ? 100 - roundRemainder : -roundRemainder;
  const grandTotalPaise = netTotalPaise + roundOffPaise;

  // Hold and Recall
  const holdBill = () => {
    if (cartLines.length === 0) {
      warning("Empty Cart", "Cannot hold an empty bill.");
      return;
    }
    const bill: HeldBill = {
      id: `held_${Date.now()}`,
      date: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      patientName: patientName || "Walk-in Patient",
      lines: [...cartLines],
    };
    setHeldBills((prev) => [...prev, bill]);
    setCartLines([]);
    setPatientName("");
    setPatientAddress("");
    setCustomerId("");
    setDoctorId("");
    success("Bill Held", `Bill parked in hold memory (${heldBills.length + 1} held).`);
  };

  const recallBill = (bill: HeldBill) => {
    setCartLines(bill.lines);
    setPatientName(bill.patientName !== "Walk-in Patient" ? bill.patientName : "");
    setHeldBills((prev) => prev.filter((b) => b.id !== bill.id));
    setShowRecallModal(false);
    success("Bill Recalled", "Held bill loaded into counter terminal.");
  };

  // Checkout and Print
  const handleCheckout = async () => {
    if (cartLines.length === 0) {
      error("Empty Cart", "Add at least one medicine before checkout.");
      return;
    }

    // Check Schedule Compliance
    if (hasRestrictedSchedule && (!patientName.trim() || !patientAddress.trim() || !doctorId)) {
      setCompliancePromptOpen(true);
      return;
    }

    try {
      const payload = {
        customerId: customerId || undefined,
        doctorId: doctorId || undefined,
        patientName: patientName.trim(),
        patientAddress: patientAddress.trim(),
        paymentMode,
        billDiscountPaise,
        lines: cartLines.map((l) => ({
          itemId: l.itemId,
          batchId: l.batchId,
          unitMode: l.unitMode,
          qty: l.qty,
          discountPct: l.discountPct,
        })),
      };

      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to commit sale");
      }

      const saleResult = await res.json();
      success("Bill Dispensed", `Invoice ${saleResult.invoiceNo} generated successfully.`);

      // Open 3-in-1 Print Modal with dynamic offline NPCI UPI QR code
      const doc = doctors.find((d) => d.id === doctorId);
      const upiUri = buildUpiUri({
        pa: shop.gstin ? `${shop.gstin}@upi` : "pharmapilot@upi",
        pn: shop.name || "PharmaPilot Pharmacy",
        am: paiseToRupeesStr(saleResult.totalPaise),
        tn: `Invoice ${saleResult.invoiceNo}`,
      });

      setPrintModalData({
        ...saleResult,
        shop,
        patientName: patientName || "Walk-in Retail Customer",
        doctorName: doc?.name,
        doctorRegNo: doc?.reg_no,
        paymentMode,
        lines: computedLines,
        upiUri,
        upiQrSvg: generateQrSvg(upiUri, 130),
      });

      // Clear counter state
      setCartLines([]);
      setPatientName("");
      setPatientAddress("");
      setCustomerId("");
      setDoctorId("");
      setBillDiscountRupees("0");
      loadCatalog(); // Refresh catalog stock levels
    } catch (err: any) {
      error("Checkout Failed", err.message || "Failed to process sale.");
    }
  };

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col gap-3 pb-2 select-none">
      {/* Top Counter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm shrink-0">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Customer Picker */}
          <div className="relative min-w-[200px] flex-1 max-w-[260px]">
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                const cust = customers.find((c) => c.id === e.target.value);
                if (cust) {
                  setPatientName(cust.name);
                  setPatientAddress(cust.address || "");
                }
              }}
              className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
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

          {/* Patient Name */}
          <input
            type="text"
            placeholder="Patient Name"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            className={`h-8 px-2.5 text-xs rounded-md border bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 min-w-[150px] focus:outline-none ${
              hasRestrictedSchedule && !patientName.trim()
                ? "border-rose-400 focus:border-rose-500"
                : "border-slate-200 dark:border-navy-700 focus:border-teal-500"
            }`}
          />

          {/* Prescribing Doctor */}
          <div className="relative min-w-[200px] flex-1 max-w-[260px]">
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              className={`w-full h-8 pl-8 pr-3 text-xs rounded-md border bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none ${
                hasRestrictedSchedule && !doctorId
                  ? "border-rose-400 focus:border-rose-500"
                  : "border-slate-200 dark:border-navy-700 focus:border-teal-500"
              }`}
            >
              <option value="">Select Doctor...</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.reg_no})
                </option>
              ))}
            </select>
            <Stethoscope className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400 stroke-[2]" />
          </div>

          {/* Payment Mode */}
          <select
            value={paymentMode}
            onChange={(e: any) => setPaymentMode(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500 font-medium"
          >
            <option value="cash">Cash Tender</option>
            <option value="upi">UPI / QR Code</option>
            <option value="card">Card POS</option>
            <option value="credit">Credit Ledger</option>
          </select>
        </div>

        {/* Counter Utilities: Hold / Recall */}
        <div className="flex items-center gap-2">
          <button
            onClick={holdBill}
            title="Hold current bill"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-navy-700 shadow-sm transition-colors"
          >
            <PauseCircle className="w-3.5 h-3.5 text-amber-600 stroke-[2]" />
            <span>Hold Bill</span>
          </button>

          <button
            onClick={() => setShowRecallModal(true)}
            disabled={heldBills.length === 0}
            title="Recall parked bill"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-navy-700 shadow-sm transition-colors disabled:opacity-40"
          >
            <PlayCircle className="w-3.5 h-3.5 text-teal-600 stroke-[2]" />
            <span>Recall ({heldBills.length})</span>
          </button>
        </div>
      </div>

      {/* Main Split-Pane Workspace: Left 60% Cart, Right 40% Search & Batch/Salt Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Left 60% (7 cols): Running Cart Table & Checkout Summary */}
        <div className="lg:col-span-7 flex flex-col rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
          {/* Cart Header */}
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 flex items-center justify-between bg-slate-50/50 dark:bg-navy-900/30">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-teal-600 dark:text-teal-400 stroke-[2]" />
              <h3 className="font-semibold text-xs text-navy-900 dark:text-slate-100">
                Running Bill ({cartLines.length} Items)
              </h3>
            </div>
            {hasRestrictedSchedule && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                <ShieldAlert className="w-3 h-3 stroke-[2]" />
                Schedule Rx Log Mandatory
              </span>
            )}
          </div>

          {/* Cart Table */}
          <div className="flex-1 overflow-y-auto">
            {computedLines.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
                <ShoppingCart className="w-10 h-10 stroke-[1.5] text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Cart is currently empty
                </p>
                <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                  Scan barcode with wedge scanner or select medicine from search panel on right.
                </p>
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 font-semibold sticky top-0 z-10">
                  <tr>
                    <th className="py-2 px-3">Item / Salt</th>
                    <th className="py-2 px-2 text-center">Batch</th>
                    <th className="py-2 px-2 text-center">Unit</th>
                    <th className="py-2 px-2 text-center">Qty</th>
                    <th className="py-2 px-3 text-right">MRP</th>
                    <th className="py-2 px-3 text-right">Total</th>
                    <th className="py-2 px-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                  {computedLines.map((line) => (
                    <tr
                      key={line.id}
                      className="hover:bg-slate-50/60 dark:hover:bg-navy-750 transition-colors"
                    >
                      <td className="py-2 px-3">
                        <div className="font-semibold text-navy-900 dark:text-slate-100 leading-tight">
                          {line.item?.name}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[180px]">
                          {line.item?.genericName}
                        </div>
                      </td>

                      {/* Batch Selector */}
                      <td className="py-2 px-2 text-center">
                        <button
                          onClick={() => setShowBatchModalForLineIdx(line.idx)}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border border-slate-200 dark:border-navy-700 hover:border-teal-500 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-300 transition-colors"
                        >
                          {line.batch?.batchNo || "Select"}
                        </button>
                      </td>

                      {/* Unit Picker (Pack / Loose) */}
                      <td className="py-2 px-2 text-center">
                        <select
                          value={line.unitMode}
                          onChange={(e: any) => {
                            const newMode = e.target.value;
                            setCartLines((prev) =>
                              prev.map((l, i) => (i === line.idx ? { ...l, unitMode: newMode } : l))
                            );
                          }}
                          className="text-[10px] h-6 px-1 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-800 dark:text-slate-200 focus:outline-none"
                        >
                          <option value="pack">
                            {line.item?.saleUnit} ({line.packSize})
                          </option>
                          <option value="loose">Loose {line.item?.baseUnit}</option>
                        </select>
                      </td>

                      {/* Quantity Stepper */}
                      <td className="py-2 px-2 text-center">
                        <div className="inline-flex items-center border border-slate-200 dark:border-navy-700 rounded bg-slate-50 dark:bg-navy-900">
                          <button
                            onClick={() => {
                              if (line.qty > 1) {
                                setCartLines((prev) =>
                                  prev.map((l, i) => (i === line.idx ? { ...l, qty: l.qty - 1 } : l))
                                );
                              } else {
                                setCartLines((prev) => prev.filter((_, i) => i !== line.idx));
                              }
                            }}
                            className="p-1 hover:text-rose-600 transition-colors"
                          >
                            <Minus className="w-3 h-3 stroke-[2.5]" />
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={line.qty}
                            onChange={(e) => {
                              const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                              setCartLines((prev) =>
                                prev.map((l, i) => (i === line.idx ? { ...l, qty: val } : l))
                              );
                            }}
                            className="w-8 text-center text-xs font-mono font-bold bg-transparent focus:outline-none"
                          />
                          <button
                            onClick={() => {
                              setCartLines((prev) =>
                                prev.map((l, i) => (i === line.idx ? { ...l, qty: l.qty + 1 } : l))
                              );
                            }}
                            className="p-1 hover:text-teal-600 transition-colors"
                          >
                            <Plus className="w-3 h-3 stroke-[2.5]" />
                          </button>
                        </div>
                      </td>

                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatINR(line.unitMrpPaise)}
                      </td>

                      <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-navy-900 dark:text-slate-100">
                        {formatINR(line.lineTotalPaise)}
                      </td>

                      {/* Line Tools: Substitute Finder & Remove */}
                      <td className="py-2 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => line.item && setSubstituteItem(line.item)}
                            title="Find Salt Substitute"
                            className="p-1 rounded text-slate-400 hover:text-teal-600 hover:bg-slate-100 dark:hover:bg-navy-700 transition-colors"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5 stroke-[2]" />
                          </button>
                          <button
                            onClick={() =>
                              setCartLines((prev) => prev.filter((_, i) => i !== line.idx))
                            }
                            title="Remove line"
                            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-navy-700 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5 stroke-[2]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Cart Bottom Summary & Checkout Button */}
          <div className="p-3 border-t border-slate-200 dark:border-navy-700 bg-slate-50/70 dark:bg-navy-900/50 flex flex-col gap-2 shrink-0">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-3">
                <span>Taxable: <strong className="font-mono text-slate-700 dark:text-slate-300">{formatINR(subtotalPaise)}</strong></span>
                <span>GST: <strong className="font-mono text-slate-700 dark:text-slate-300">{formatINR(taxPaise)}</strong></span>
                <span>Round-Off: <strong className="font-mono text-slate-700 dark:text-slate-300">{formatINR(roundOffPaise)}</strong></span>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-[11px]">Extra Discount (₹):</span>
                <input
                  type="number"
                  min="0"
                  value={billDiscountRupees}
                  onChange={(e) => setBillDiscountRupees(e.target.value)}
                  className="w-16 h-6 px-1.5 text-right text-xs font-mono rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div>
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider block">Net Amount</span>
                <span className="text-2xl font-bold font-mono text-teal-700 dark:text-teal-400 tabular-nums">
                  {formatINR(grandTotalPaise)}
                </span>
              </div>

              <button
                onClick={handleCheckout}
                disabled={cartLines.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors disabled:opacity-50"
              >
                <Printer className="w-4 h-4 stroke-[2]" />
                <span>Save & Print Invoice</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right 40% (5 cols): Medicine Search & Live Batch Card */}
        <div className="lg:col-span-5 flex flex-col gap-3 min-h-0">
          {/* Prominent Search Bar */}
          <div className="p-3 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm shrink-0">
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search name, salt, barcode, or 2*dolo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="w-full h-9 pl-9 pr-3 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500 font-medium"
              />
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 stroke-[2]" />
            </div>

            {/* Quick Filter Pill Badges */}
            <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
              <span className="text-slate-400 shrink-0">Suggestions:</span>
              {catalog.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  onClick={() => addItemWithFEFO(item.id, 1, "pack")}
                  className="px-2 py-0.5 rounded-full border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-700 dark:text-slate-300 hover:border-teal-500 shrink-0 truncate max-w-[130px]"
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          {/* Search Results List */}
          <div className="flex-1 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
                Medicine Catalog ({searchResults.length})
              </span>
              <span className="text-[10px] text-slate-400 font-mono">FEFO Prioritized</span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-navy-700">
              {searchResults.map((item) => {
                const earliestBatch = item.batches
                  .filter((b) => b.availableQtyBase > 0)
                  .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0];

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelectedCatalogItem(item)}
                    className={`p-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-navy-750 cursor-pointer transition-colors ${
                      selectedCatalogItem?.id === item.id ? "bg-teal-50/60 dark:bg-teal-950/40" : ""
                    }`}
                  >
                    <div className="flex-1 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs text-navy-900 dark:text-slate-100">
                          {item.name}
                        </span>
                        {item.schedule !== "none" && item.schedule !== "OTC" && (
                          <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                            {item.schedule}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {item.genericName} · Rack: {item.rackLocation || "General"}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <div className="font-mono text-xs font-bold text-navy-900 dark:text-slate-100">
                          {earliestBatch ? formatINR(earliestBatch.mrpPaise) : "—"}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          {item.totalStockBase > 0 ? (
                            <span className="text-teal-600 dark:text-teal-400 font-semibold">
                              {item.totalStockBase} {item.baseUnit}
                            </span>
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400 font-semibold">0 Stock</span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addItemWithFEFO(item.id, 1, "pack");
                        }}
                        className="p-1.5 rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
                        title="Add to Bill"
                      >
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Batch & Bio-Equivalent Quick Card */}
          {selectedCatalogItem && (
            <div className="p-3 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm shrink-0 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-navy-900 dark:text-slate-100 block">
                    {selectedCatalogItem.name}
                  </span>
                  <span className="text-[10px] text-slate-400">{selectedCatalogItem.genericName}</span>
                </div>

                <button
                  onClick={() => setSubstituteItem(selectedCatalogItem)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 hover:bg-teal-100 transition-colors"
                >
                  <ArrowRightLeft className="w-3 h-3 stroke-[2]" />
                  <span>Salt Substitutes</span>
                </button>
              </div>

              {/* Batches Preview */}
              <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-navy-700">
                <span className="text-[10px] uppercase font-semibold text-slate-400">Available Batches (FEFO)</span>
                <div className="grid grid-cols-2 gap-1.5 max-h-24 overflow-y-auto">
                  {selectedCatalogItem.batches.map((b) => (
                    <div
                      key={b.id}
                      className="p-1.5 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-[11px]"
                    >
                      <div className="flex items-center justify-between font-mono font-semibold">
                        <span>{b.batchNo}</span>
                        <span className="text-teal-600">{b.availableQtyBase} {selectedCatalogItem.baseUnit}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>Exp: {b.expiryDate}</span>
                        <span>{formatINR(b.mrpPaise)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Slide-over Salt Substitute Drawer */}
      {substituteItem && (
        <div className="fixed inset-0 z-50 flex justify-end bg-navy-950/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white dark:bg-navy-900 h-full shadow-2xl border-l border-slate-200 dark:border-navy-700 flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-navy-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-teal-600 stroke-[2]" />
                  <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                    Bio-Equivalent Salt Substitutes
                  </h3>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Same salt formulation: <strong className="text-teal-700 dark:text-teal-300">{substituteItem.genericName}</strong>
                </p>
              </div>

              <button
                onClick={() => setSubstituteItem(null)}
                className="p-1 rounded-md text-slate-400 hover:text-navy-900 dark:hover:text-slate-100"
              >
                <X className="w-4 h-4 stroke-[2]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(() => {
                const targetSalt = substituteItem.genericName.trim().toLowerCase();
                const substitutes = catalog
                  .filter((i) => i.id !== substituteItem.id && i.genericName.trim().toLowerCase() === targetSalt)
                  .map((sub) => {
                    const subBatch = sub.batches
                      .filter((b) => b.availableQtyBase > 0)
                      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0];
                    const refBatch = substituteItem.batches[0];
                    const savingsPaise =
                      refBatch && subBatch ? Math.max(0, refBatch.mrpPaise - subBatch.mrpPaise) : 0;
                    return { sub, subBatch, savingsPaise };
                  })
                  .sort((a, b) => b.savingsPaise - a.savingsPaise);

                if (substitutes.length === 0) {
                  return (
                    <div className="text-center py-12 text-slate-400 text-xs">
                      No other medicines with the exact same active salt formula in stock.
                    </div>
                  );
                }

                return substitutes.map(({ sub, subBatch, savingsPaise }) => (
                  <div
                    key={sub.id}
                    className="p-3 rounded-lg border border-slate-200 dark:border-navy-700 bg-slate-50/60 dark:bg-navy-800 flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-navy-900 dark:text-slate-100">{sub.name}</span>
                        {savingsPaise > 0 && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            Save {formatINR(savingsPaise)}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        Stock: <strong className="font-mono text-slate-700 dark:text-slate-300">{sub.totalStockBase} {sub.baseUnit}</strong> · Rack {sub.rackLocation}
                      </div>
                      <div className="text-[11px] font-mono text-slate-700 dark:text-slate-300 mt-0.5">
                        MRP: {subBatch ? formatINR(subBatch.mrpPaise) : "—"} / {sub.saleUnit}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        addItemWithFEFO(sub.id, 1, "pack");
                        setSubstituteItem(null);
                        success("Substituted", `Added ${sub.name} to bill.`);
                      }}
                      className="px-3 py-1.5 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
                    >
                      Substitute
                    </button>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Recall Held Bills Modal */}
      {showRecallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-slate-200 dark:border-navy-700 p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-800">
              <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                Recall Parked Bills ({heldBills.length})
              </h3>
              <button onClick={() => setShowRecallModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4 stroke-[2]" />
              </button>
            </div>

            <div className="py-3 space-y-2 max-h-60 overflow-y-auto">
              {heldBills.map((b) => (
                <div
                  key={b.id}
                  className="p-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-semibold text-navy-900 dark:text-slate-100">{b.patientName}</div>
                    <div className="text-[10px] text-slate-400">Parked at {b.date} · {b.lines.length} Items</div>
                  </div>
                  <button
                    onClick={() => recallBill(b)}
                    className="px-2.5 py-1 text-xs font-medium rounded bg-teal-600 text-white hover:bg-teal-700"
                  >
                    Resume Bill
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Schedule H/H1 Compliance Check Modal */}
      {compliancePromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-rose-200 dark:border-rose-900 p-5">
            <div className="flex items-center gap-2 pb-2 text-rose-700 dark:text-rose-400 border-b border-rose-100 dark:border-rose-900/50">
              <ShieldAlert className="w-5 h-5 stroke-[2.5]" />
              <h3 className="font-bold text-sm">Schedule H1 / X Prescription Compliance Required</h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 mt-3 leading-relaxed">
              Under CDSCO Drugs & Cosmetics Rules, Schedule H, H1, and X drugs require mandatory recording of
              Patient Name, Address, and Prescribing Doctor details before invoice generation.
            </p>

            <div className="space-y-2 mt-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Patient Name *
                </label>
                <input
                  type="text"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="Full name of patient"
                  className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Patient Address *
                </label>
                <input
                  type="text"
                  value={patientAddress}
                  onChange={(e) => setPatientAddress(e.target.value)}
                  placeholder="Address or locality"
                  className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Prescribing Doctor *
                </label>
                <select
                  value={doctorId}
                  onChange={(e) => setDoctorId(e.target.value)}
                  className="w-full h-8 px-2 text-xs rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800"
                >
                  <option value="">Select registered doctor...</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.reg_no})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setCompliancePromptOpen(false)}
                className="px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-navy-700 text-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (patientName.trim() && patientAddress.trim() && doctorId) {
                    setCompliancePromptOpen(false);
                    handleCheckout();
                  } else {
                    error("Mandatory Fields", "Please enter patient name, address, and select doctor.");
                  }
                }}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-teal-600 hover:bg-teal-700 text-white"
              >
                Confirm & Dispense
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3-in-1 Print Modal with NPCI Offline UPI QR Code */}
      {printModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-2xl p-6 text-slate-900 border border-slate-200 my-auto">
            {/* Modal Controls Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 no-print">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-teal-600 stroke-[2]" />
                <h3 className="font-bold text-sm text-navy-900">
                  GST Tax Invoice — {printModalData.invoiceNo}
                </h3>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPrintFormat("80mm")}
                  className={`px-2.5 py-1 text-xs font-medium rounded border ${
                    printFormat === "80mm" ? "bg-teal-600 text-white border-teal-600" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  80mm Thermal
                </button>
                <button
                  onClick={() => setPrintFormat("58mm")}
                  className={`px-2.5 py-1 text-xs font-medium rounded border ${
                    printFormat === "58mm" ? "bg-teal-600 text-white border-teal-600" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  58mm Compact
                </button>
                <button
                  onClick={() => setPrintFormat("a4")}
                  className={`px-2.5 py-1 text-xs font-medium rounded border ${
                    printFormat === "a4" ? "bg-teal-600 text-white border-teal-600" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  A4 Tax Invoice
                </button>
                <button
                  onClick={() => setPrintModalData(null)}
                  className="p-1 rounded text-slate-400 hover:text-slate-600 ml-2"
                >
                  <X className="w-4 h-4 stroke-[2]" />
                </button>
              </div>
            </div>

            {/* Printable Invoice Container */}
            <div
              className={`mt-4 mx-auto p-4 bg-white border border-slate-200 text-slate-900 ${
                printFormat === "58mm" ? "max-w-[260px] text-[11px]" : printFormat === "80mm" ? "max-w-[360px] text-xs" : "w-full text-xs"
              }`}
            >
              {/* Pharmacy Title & Drug License info */}
              <div className="text-center pb-3 border-b border-slate-300">
                <h2 className="text-base font-bold tracking-tight uppercase">{printModalData.shop.name || "PharmaPilot Pharmacy"}</h2>
                <div className="text-[10px] text-slate-600">{printModalData.shop.address}</div>
                <div className="text-[10px] text-slate-600 font-mono">
                  GSTIN: {printModalData.shop.gstin} · DL: {printModalData.shop.drug_license_no_1}
                </div>
              </div>

              {/* Invoice Meta */}
              <div className="py-2 flex justify-between text-[11px] border-b border-slate-200">
                <div>
                  <div><strong>Invoice:</strong> {printModalData.invoiceNo}</div>
                  <div><strong>Date:</strong> {new Date().toLocaleDateString("en-IN")}</div>
                </div>
                <div className="text-right">
                  <div><strong>Patient:</strong> {printModalData.patientName}</div>
                  {printModalData.doctorName && (
                    <div className="text-[10px] text-slate-600">Dr. {printModalData.doctorName}</div>
                  )}
                </div>
              </div>

              {/* Items List */}
              <div className="py-2 border-b border-slate-200">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-300 font-semibold">
                      <th className="text-left pb-1">Item</th>
                      <th className="text-center pb-1">Qty</th>
                      <th className="text-right pb-1">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {printModalData.lines.map((l: any, i: number) => (
                      <tr key={i}>
                        <td className="py-1">
                          <div className="font-semibold">{l.item?.name}</div>
                          <div className="text-[9px] text-slate-500 font-mono">
                            {l.batch?.batchNo} · {l.batch?.expiryDate}
                          </div>
                        </td>
                        <td className="py-1 text-center font-mono">{l.qty}</td>
                        <td className="py-1 text-right font-mono font-bold">{formatINR(l.lineTotalPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals & Offline NPCI UPI QR */}
              <div className="py-3 flex items-center justify-between">
                {/* Dynamic Offline NPCI QR Code */}
                <div className="flex flex-col items-center">
                  <div
                    className="p-1 border border-slate-200 rounded"
                    dangerouslySetInnerHTML={{ __html: printModalData.upiQrSvg }}
                  />
                  <span className="text-[9px] font-semibold text-slate-500 mt-0.5">Scan to Pay via UPI</span>
                </div>

                <div className="text-right space-y-0.5 text-xs">
                  <div>Taxable: <span className="font-mono">{formatINR(printModalData.subtotalPaise)}</span></div>
                  <div>CGST + SGST: <span className="font-mono">{formatINR(printModalData.cgstPaise + printModalData.sgstPaise)}</span></div>
                  <div>Round-off: <span className="font-mono">{formatINR(printModalData.roundOffPaise)}</span></div>
                  <div className="text-sm font-bold font-mono text-navy-900 pt-1 border-t border-slate-300">
                    Grand Total: {formatINR(printModalData.totalPaise)}
                  </div>
                </div>
              </div>

              <div className="text-center text-[9px] text-slate-500 pt-2 border-t border-slate-200">
                Goods sold taken back within 3 days with bill. Get well soon!
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-200 no-print">
              <button
                onClick={() => setPrintModalData(null)}
                className="px-4 py-1.5 text-xs font-medium rounded border border-slate-200 text-slate-700"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded bg-teal-600 hover:bg-teal-700 text-white"
              >
                <Printer className="w-3.5 h-3.5 stroke-[2]" />
                <span>Print Bill</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
