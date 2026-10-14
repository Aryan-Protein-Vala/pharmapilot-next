"use client";

import React, { useState, useEffect } from "react";
import {
  FileCheck,
  Download,
  Printer,
  FileSpreadsheet,
  Layers,
  ArrowUpRight,
  TrendingDown,
  RefreshCw,
  Building,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/lib/money";

interface GstReportsData {
  shop: any;
  outward: {
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalTaxPaise: number;
    sales: any[];
  };
  itc: {
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalItcPaise: number;
    purchases: any[];
  };
  netPayablePaise: number;
  hsnSummary: Array<{
    hsn_code: string;
    total_qty: number;
    taxable_paise: number;
    tax_paise: number;
    total_paise: number;
  }>;
  gstr1Payload: any;
}

export default function GstReportsPage() {
  const { success, error, info } = useToast();

  const [data, setData] = useState<GstReportsData | null>(null);
  const [activeTab, setActiveTab] = useState<"gstr1" | "gstr3b" | "hsn">("gstr1");
  const [loading, setLoading] = useState(true);

  const fetchGstData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/gst-reports");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to load GST reports", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGstData();
  }, []);

  const exportGstr1Json = () => {
    if (!data?.gstr1Payload) {
      error("Export Failed", "No GSTR-1 data available to export.");
      return;
    }
    const jsonStr = JSON.stringify(data.gstr1Payload, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `GSTR1_Return_${data.shop.gstin || "PHARMA"}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    success("JSON Exported", "Official GST Portal GSTR-1 JSON downloaded successfully.");
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto select-none">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              GST Tax Hub & Statutory Returns
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              GSTIN: {data?.shop?.gstin || "Active"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            GSTR-1 outward supplies, GSTR-3B ITC reconciliation, and Table 12 HSN summaries reconciled from posted invoices.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchGstData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-teal-600" : "text-slate-500"}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={exportGstr1Json}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5 stroke-[2]" />
            <span>Export GSTR-1 Portal JSON</span>
          </button>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
          >
            <Printer className="w-3.5 h-3.5 stroke-[2]" />
            <span>Print CA Pack</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            GSTR-1 Outward Taxable
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-navy-900 dark:text-slate-100 tabular-nums">
            {data ? formatINR(data.outward.taxablePaise) : "₹0.00"}
          </div>
          <span className="text-[10px] text-slate-400">{data?.outward.sales.length ?? 0} Invoices Dispatched</span>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Outward Output Tax
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">
            {data ? formatINR(data.outward.totalTaxPaise) : "₹0.00"}
          </div>
          <span className="text-[10px] text-slate-400">CGST + SGST + IGST</span>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            GSTR-3B Input Tax Credit (ITC)
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-teal-700 dark:text-teal-400 tabular-nums">
            {data ? formatINR(data.itc.totalItcPaise) : "₹0.00"}
          </div>
          <span className="text-[10px] text-slate-400">{data?.itc.purchases.length ?? 0} Purchase Invoices</span>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Net GST Liability
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-navy-900 dark:text-slate-100 tabular-nums">
            {data ? formatINR(data.netPayablePaise) : "₹0.00"}
          </div>
          <span className="text-[10px] text-slate-400">After ITC Offset</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-navy-800">
        <button
          onClick={() => setActiveTab("gstr1")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "gstr1"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          GSTR-1 Outward Supplies (B2B / B2C)
        </button>
        <button
          onClick={() => setActiveTab("gstr3b")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "gstr3b"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          GSTR-3B ITC Summary (Purchases)
        </button>
        <button
          onClick={() => setActiveTab("hsn")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "hsn"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Table 12 HSN Summary
        </button>
      </div>

      {/* Tab 1: GSTR-1 Outward Supplies */}
      {activeTab === "gstr1" && (
        <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Invoice #</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Customer / Recipient</th>
                  <th className="py-2.5 px-2 text-center">Type</th>
                  <th className="py-2.5 px-3 text-right">Taxable Value</th>
                  <th className="py-2.5 px-3 text-right">CGST</th>
                  <th className="py-2.5 px-3 text-right">SGST</th>
                  <th className="py-2.5 px-3 text-right">IGST</th>
                  <th className="py-2.5 px-3 text-right">Invoice Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {data?.outward.sales.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-medium text-teal-700 dark:text-teal-400">
                      {s.invoice_no}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{s.invoice_date}</td>
                    <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">
                      {s.customer_name || "B2C Consumer (Unregistered)"}
                      {s.customer_gstin && (
                        <div className="text-[10px] text-slate-400 font-mono">GSTIN: {s.customer_gstin}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold ${
                        s.customer_gstin ? "bg-purple-100 text-purple-800" : "bg-slate-100 text-slate-700 dark:bg-navy-700 dark:text-slate-300"
                      }`}>
                        {s.customer_gstin ? "B2B" : "B2C"}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatINR(s.subtotal_paise)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatINR(s.cgst_paise)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatINR(s.sgst_paise)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatINR(s.igst_paise)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                      {formatINR(s.total_paise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: GSTR-3B ITC Summary */}
      {activeTab === "gstr3b" && (
        <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Supplier Invoice #</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Distributor Name</th>
                  <th className="py-2.5 px-3">Supplier GSTIN</th>
                  <th className="py-2.5 px-3 text-right">Taxable (Inward)</th>
                  <th className="py-2.5 px-3 text-right">Eligible CGST</th>
                  <th className="py-2.5 px-3 text-right">Eligible SGST</th>
                  <th className="py-2.5 px-3 text-right">Total ITC Claimable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {data?.itc.purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-medium text-teal-700 dark:text-teal-400">
                      {p.supplier_invoice_no}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{p.invoice_date}</td>
                    <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">
                      {p.supplier_name}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{p.supplier_gstin || "—"}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatINR(p.subtotal_paise)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatINR(p.cgst_paise)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatINR(p.sgst_paise)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-teal-700 dark:text-teal-400">
                      {formatINR(p.cgst_paise + p.sgst_paise + p.igst_paise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Table 12 HSN Summary */}
      {activeTab === "hsn" && (
        <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">HSN Code</th>
                  <th className="py-2.5 px-3 text-right">Total Qty Sold (Base)</th>
                  <th className="py-2.5 px-3 text-right">Taxable Value</th>
                  <th className="py-2.5 px-3 text-right">Central Tax (CGST)</th>
                  <th className="py-2.5 px-3 text-right">State Tax (SGST)</th>
                  <th className="py-2.5 px-3 text-right">Total Invoice Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {data?.hsnSummary.map((h) => (
                  <tr key={h.hsn_code} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-navy-900 dark:text-slate-100">
                      {h.hsn_code}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{h.total_qty}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatINR(h.taxable_paise)}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatINR(Math.floor(h.tax_paise / 2))}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatINR(h.tax_paise - Math.floor(h.tax_paise / 2))}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-navy-900 dark:text-slate-100">
                      {formatINR(h.total_paise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
