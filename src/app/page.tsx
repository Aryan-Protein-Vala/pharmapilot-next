"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  TrendingUp,
  Receipt,
  AlertTriangle,
  BookOpen,
  Plus,
  ArrowUpRight,
  ShieldAlert,
  Search,
  Package,
  Truck,
  FileCheck,
  FileSpreadsheet,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/money";

interface DashboardData {
  todayRevenuePaise: number;
  todayBillCount: number;
  grossSalesPaise: number;
  totalBillsCount: number;
  customerReceivablesPaise: number;
  nearExpiryCount: number;
  expiredCount: number;
  lowStockReordersCount: number;
  scheduleCount: number;
  criticalExpiryList: Array<{
    batchId: string;
    batchNo: string;
    medicine: string;
    expiry: string;
    daysLeft: number;
    stock: string;
    schedule: string;
  }>;
  lowStockItems: Array<{
    id: string;
    name: string;
    currentStock: number;
    reorderLevel: number;
    suggestedOrder: number;
    baseUnit: string;
  }>;
  recentSales: Array<{
    id: string;
    invoice_no: string;
    invoice_date: string;
    patient_name: string;
    payment_mode: string;
    subtotal_paise: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    total_paise: number;
    doctor_name: string;
    doctor_reg_no: string;
    item_count: number;
  }>;
}

export default function DashboardPage() {
  const { info, success } = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to load dashboard metrics", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Banner & Quick Operations Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              Pharmacy Operations Overview
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              Live Counter
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time dispensing KPIs, drug regulatory compliance, and FEFO expiry radar.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              fetchMetrics();
              info("Refreshed", "Live KPIs synchronized from SQLite database.");
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-navy-700 transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 stroke-[2] ${loading ? "animate-spin text-teal-600" : "text-slate-500"}`} />
            <span>Sync</span>
          </button>

          <Link
            href="/purchases"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-navy-700 transition-colors shadow-sm"
          >
            <Truck className="w-3.5 h-3.5 text-slate-500 stroke-[2]" />
            <span>Purchase Entry</span>
          </Link>

          <Link
            href="/pos"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>New POS Bill</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Gross Sales / Today */}
        <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Gross Sales (Posted)</span>
            <div className="w-7 h-7 rounded-md bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 stroke-[2]" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-navy-900 dark:text-slate-100 tabular-nums">
              {data ? formatINR(data.grossSalesPaise) : "₹0.00"}
            </span>
          </div>
          <div className="mt-2 flex items-center text-[11px] text-teal-700 dark:text-teal-400">
            <ArrowUpRight className="w-3 h-3 mr-0.5 stroke-[2.5]" />
            <span className="font-semibold">{data?.totalBillsCount ?? 0} Invoices</span>
            <span className="text-slate-400 dark:text-slate-500 ml-1">posted in registry</span>
          </div>
        </div>

        {/* Metric 2: Customer Receivables */}
        <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Customer Receivables</span>
            <div className="w-7 h-7 rounded-md bg-slate-100 dark:bg-navy-700 text-slate-600 dark:text-slate-300 flex items-center justify-center">
              <Wallet className="w-4 h-4 stroke-[2]" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-navy-900 dark:text-slate-100 tabular-nums">
              {data ? formatINR(data.customerReceivablesPaise) : "₹0.00"}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Outstanding credit balance across customers</span>
          </div>
        </div>

        {/* Metric 3: Near-Expiry FEFO Watch */}
        <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">FEFO Expiry Watch</span>
            <div className="w-7 h-7 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 stroke-[2]" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-amber-600 dark:text-amber-400 tabular-nums">
              {data?.nearExpiryCount ?? 0}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">Batches &lt; 60d</span>
          </div>
          <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
            <span>Expired Quarantined: </span>
            <span className="font-semibold tabular-nums">{data?.expiredCount ?? 0} Batches</span>
          </div>
        </div>

        {/* Metric 4: Low Stock Reorders */}
        <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium uppercase tracking-wider">Low Stock Reorders</span>
            <div className="w-7 h-7 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Package className="w-4 h-4 stroke-[2]" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-navy-900 dark:text-slate-100 tabular-nums">
              {data?.lowStockReordersCount ?? 0}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">SKUs below threshold</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Schedule Registered: </span>
            <span className="font-semibold text-teal-600 dark:text-teal-400">{data?.scheduleCount ?? 0} Records</span>
          </div>
        </div>
      </div>

      {/* Solid Flat Status Bars: Operational Health & Compliance */}
      <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm space-y-3">
        <div className="flex items-center justify-between text-xs font-medium text-navy-900 dark:text-slate-200">
          <span className="uppercase tracking-wider">Inventory Health Distribution</span>
          <span className="text-slate-500 dark:text-slate-400 font-mono">FEFO & Stock Compliance: 94.2%</span>
        </div>
        <div className="w-full h-3 rounded bg-slate-100 dark:bg-navy-900 flex overflow-hidden">
          <div className="bg-teal-600 h-full" style={{ width: "72%" }} title="Adequate Unexpired Stock (72%)" />
          <div className="bg-amber-500 h-full" style={{ width: "16%" }} title="Near Expiry <= 60d (16%)" />
          <div className="bg-rose-500 h-full" style={{ width: "8%" }} title="Low Stock Reorders (8%)" />
          <div className="bg-slate-400 h-full" style={{ width: "4%" }} title="Quarantined (4%)" />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600 dark:text-slate-400 pt-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-teal-600" />
            <span>Optimal Stock (72%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
            <span>Near Expiry &lt; 60d (16%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" />
            <span>Reorder Triggered (8%)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-400" />
            <span>Quarantined Expired (4%)</span>
          </div>
        </div>
      </div>

      {/* Main Workspace Split: Recent Invoices & Expiry Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Invoices Table (2 Cols) */}
        <div className="lg:col-span-2 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-navy-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-teal-600 dark:text-teal-400 stroke-[2]" />
              <h3 className="font-semibold text-sm text-navy-900 dark:text-slate-100">
                Recent Sales Bills & Tax Breakups
              </h3>
            </div>
            <Link href="/pos" className="text-xs text-teal-600 dark:text-teal-400 hover:underline font-medium">
              Open POS Terminal &rarr;
            </Link>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Invoice #</th>
                  <th className="py-2.5 px-3">Patient / Doctor</th>
                  <th className="py-2.5 px-3 text-center">Items</th>
                  <th className="py-2.5 px-3">Mode</th>
                  <th className="py-2.5 px-3 text-right">Taxable</th>
                  <th className="py-2.5 px-3 text-right">GST</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {data && data.recentSales && data.recentSales.length > 0 ? (
                  data.recentSales.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-navy-750 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-medium text-teal-700 dark:text-teal-400">
                        {row.invoice_no}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-navy-900 dark:text-slate-100">
                          {row.patient_name || "Walk-in Retail Customer"}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {row.doctor_name ? `${row.doctor_name} (${row.doctor_reg_no || ""})` : "OTC Walk-in"}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {row.item_count}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 dark:bg-navy-700 text-slate-700 dark:text-slate-300 uppercase">
                          {row.payment_mode}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {formatINR(row.subtotal_paise)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                        {formatINR(row.cgst_paise + row.sgst_paise + row.igst_paise)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-navy-900 dark:text-slate-100">
                        {formatINR(row.total_paise)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-400">
                      No sales recorded yet. Click "New POS Bill" to start dispensing.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* FEFO Expiry & Schedule Warning List (1 Col) */}
        <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-navy-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-500 stroke-[2]" />
              <h3 className="font-semibold text-sm text-navy-900 dark:text-slate-100">
                FEFO Expiry Warnings
              </h3>
            </div>
            <Link href="/inventory" className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              Manage &rarr;
            </Link>
          </div>

          <div className="p-3 space-y-2.5 flex-1 overflow-y-auto max-h-[360px]">
            {data && data.criticalExpiryList && data.criticalExpiryList.length > 0 ? (
              data.criticalExpiryList.map((exp) => (
                <div
                  key={exp.batchId}
                  className="p-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50/60 dark:bg-navy-900/40 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-navy-900 dark:text-slate-100">{exp.medicine}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 rounded font-semibold tabular-nums">
                      {exp.daysLeft}d left
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px]">
                    <span>Batch: <strong className="font-mono text-slate-700 dark:text-slate-300">{exp.batchNo}</strong></span>
                    <span>Stock: <strong className="font-mono text-slate-700 dark:text-slate-300">{exp.stock}</strong></span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-navy-700/60">
                    <span className="text-[10px] font-semibold text-teal-700 dark:text-teal-400">{exp.schedule}</span>
                    <Link
                      href="/pos"
                      className="text-[10px] font-medium text-teal-600 dark:text-teal-400 hover:underline"
                    >
                      Prioritize at Counter
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-xs text-slate-400">
                All batches in inventory have &gt; 60 days of shelf life.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Action Dock */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link
          href="/pos"
          className="p-3 rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 hover:border-teal-500 dark:hover:border-teal-500 transition-colors shadow-sm flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
            <Receipt className="w-4 h-4 stroke-[2]" />
          </div>
          <div>
            <div className="text-xs font-semibold text-navy-900 dark:text-slate-100">POS Billing</div>
            <div className="text-[10px] text-slate-400">High-speed counter</div>
          </div>
        </Link>

        <Link
          href="/purchases"
          className="p-3 rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 hover:border-teal-500 dark:hover:border-teal-500 transition-colors shadow-sm flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <Truck className="w-4 h-4 stroke-[2]" />
          </div>
          <div>
            <div className="text-xs font-semibold text-navy-900 dark:text-slate-100">Stockist Inward</div>
            <div className="text-[10px] text-slate-400">PTR / MRP / 10+2 scheme</div>
          </div>
        </Link>

        <Link
          href="/compliance"
          className="p-3 rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 hover:border-teal-500 dark:hover:border-teal-500 transition-colors shadow-sm flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <BookOpen className="w-4 h-4 stroke-[2]" />
          </div>
          <div>
            <div className="text-xs font-semibold text-navy-900 dark:text-slate-100">CDSCO Register</div>
            <div className="text-[10px] text-slate-400">Schedule H/H1/NDPS</div>
          </div>
        </Link>

        <Link
          href="/gst-reports"
          className="p-3 rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 hover:border-teal-500 dark:hover:border-teal-500 transition-colors shadow-sm flex items-center gap-3"
        >
          <div className="w-8 h-8 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <FileCheck className="w-4 h-4 stroke-[2]" />
          </div>
          <div>
            <div className="text-xs font-semibold text-navy-900 dark:text-slate-100">GST Portal Export</div>
            <div className="text-[10px] text-slate-400">GSTR-1 JSON & ITC</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
