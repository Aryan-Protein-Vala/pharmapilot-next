"use client";

import React, { useState, useEffect } from "react";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Download,
  Trash2,
  RefreshCw,
  Layers,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR, rupeesToPaise } from "@/lib/money";
import { parsePackString } from "@/lib/units";
import { parseExpiryInput } from "@/lib/dates";

const MARG_SAMPLE_CSV = `Item Name,Generic Salt,Company,Packing,HSN,GST %,Schedule,Batch No,Expiry,MRP,PTR,Closing Qty,Rack
Dolo 650 Tablet,Paracetamol 650mg,Micro Labs Ltd,1x15,30049099,12,OTC,DL650X,08/27,33.75,24.10,300,R-01
Augmentin 625 Duo Tablet,Amoxycillin 500mg + Clavulanic Acid 125mg,GSK Pharmaceuticals,1x10,30041000,12,H1,AUG26A,06/27,204.50,148.00,120,A-04
Pan 40 Tablet,Pantoprazole 40mg,Alkem Laboratories,1x15,30049034,12,H,PN4099,11/27,155.00,108.50,225,B-02
Azithral 500 Tablet,Azithromycin 500mg,Alembic Pharmaceuticals,1x5,30042061,12,H1,AZ500B,05/27,132.40,94.00,85,A-09
Shelcal 500 Tablet,Calcium 500mg + Vitamin D3 250 IU,Torrent Pharmaceuticals,1x15,30049099,12,OTC,SHC88,12/26,144.00,102.00,180,C-01`;

interface ParsedPreviewRow {
  rowNum: number;
  status: "OK" | "WARN" | "ERROR";
  reason: string;
  name: string;
  genericName: string;
  manufacturer: string;
  batchNo: string;
  expiryDate: string;
  mrpPaise: number;
  ptrPaise: number;
  qtyBase: number;
  packing: string;
  rack: string;
  schedule: string;
  hsn: string;
}

interface ImportJob {
  id: string;
  type: string;
  filename: string;
  total_rows: number;
  ok_rows: number;
  failed_rows: number;
  status: string;
  created_at: string;
}

export default function ImportWizardPage() {
  const { success, error, warning, info } = useToast();

  const [importType, setImportType] = useState<"Opening Stock" | "Medicine Master" | "Customer Master" | "Supplier Master">("Opening Stock");
  const [filename, setFilename] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedPreviewRow[]>([]);
  const [pastJobs, setPastJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/import");
      if (res.ok) {
        const data = await res.json();
        setPastJobs(data || []);
      }
    } catch (err) {
      console.error("Failed to load import jobs", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const parseCsvText = (name: string, csvContent: string) => {
    setFilename(name);
    const lines = csvContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      warning("File Empty", "Uploaded CSV file contains no data rows.");
      return;
    }

    const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
    const findCol = (terms: string[]) => header.findIndex((h) => terms.some((t) => h.includes(t)));

    const nameIdx = findCol(["item", "name", "medicine", "product"]);
    const saltIdx = findCol(["salt", "generic", "composition"]);
    const mfrIdx = findCol(["company", "mfr", "manufacturer"]);
    const packIdx = findCol(["packing", "pack", "unit"]);
    const hsnIdx = findCol(["hsn"]);
    const schedIdx = findCol(["schedule", "sched"]);
    const batchIdx = findCol(["batch", "lot"]);
    const expIdx = findCol(["expiry", "exp"]);
    const mrpIdx = findCol(["mrp", "retail"]);
    const ptrIdx = findCol(["ptr", "rate", "cost"]);
    const qtyIdx = findCol(["qty", "stock", "closing", "balance"]);
    const rackIdx = findCol(["rack", "bin", "shelf"]);

    const previewList: ParsedPreviewRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const itemName = parts[nameIdx] || "";
      if (!itemName) continue;

      const salt = parts[saltIdx] || "";
      const mfr = parts[mfrIdx] || "General Pharma";
      const packRaw = parts[packIdx] || "1x10";
      const pack = parsePackString(packRaw);
      const batchNo = (parts[batchIdx] || "OPEN-01").toUpperCase();
      const expRaw = parts[expIdx] || "12/27";
      const exp = parseExpiryInput(expRaw);
      const mrp = rupeesToPaise(parts[mrpIdx] || "10.00");
      const ptr = rupeesToPaise(parts[ptrIdx] || "7.00");
      const qtyPacks = parseInt(parts[qtyIdx] || "10", 10) || 10;
      const totalBaseQty = qtyPacks * pack.qtyInBaseUnit;
      const rack = parts[rackIdx] || "R-01";
      const sched = parts[schedIdx] || "none";

      const errs: string[] = [];
      if (!itemName) errs.push("Missing name");
      if (mrp <= 0) errs.push("MRP <= 0");
      if (!exp.valid) errs.push("Invalid expiry");

      previewList.push({
        rowNum: i,
        status: errs.length ? "ERROR" : "OK",
        reason: errs.length ? errs.join("; ") : "Ready to commit",
        name: itemName,
        genericName: salt,
        manufacturer: mfr,
        batchNo,
        expiryDate: exp.isoExpiryDate || "2027-12-31",
        mrpPaise: mrp,
        ptrPaise: ptr > 0 ? ptr : Math.round(mrp * 0.7),
        qtyBase: totalBaseQty,
        packing: packRaw,
        rack,
        schedule: sched,
        hsn: parts[hsnIdx] || "3004",
      });
    }

    setParsedRows(previewList);
    success("CSV Parsed", `${previewList.length} rows processed for Marg migration preview.`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || "");
      parseCsvText(file.name, content);
    };
    reader.readAsText(file);
  };

  const commitImport = async () => {
    const validRows = parsedRows.filter((r) => r.status === "OK");
    if (validRows.length === 0) {
      error("No Valid Rows", "No rows passed validation.");
      return;
    }

    setCommitting(true);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          filename: filename || "marg_import.csv",
          type: importType,
          rows: validRows.map((r) => ({
            name: r.name,
            genericName: r.genericName,
            manufacturer: r.manufacturer,
            batchNo: r.batchNo,
            expiryDate: r.expiryDate,
            mrpPaise: r.mrpPaise,
            ptrPaise: r.ptrPaise,
            qtyBase: r.qtyBase,
            rack: r.rack,
            schedule: r.schedule,
            hsn: r.hsn,
          })),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to commit import");
      }

      const result = await res.json();
      success("Import Committed", `Successfully migrated ${result.okCount} rows into ERP ledger!`);
      setParsedRows([]);
      setFilename("");
      fetchJobs();
    } catch (err: any) {
      error("Import Error", err.message || "Failed to commit import.");
    } finally {
      setCommitting(false);
    }
  };

  const undoJob = async (jobId: string) => {
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo", jobId }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to undo import");
      }

      success("Import Reverted", "All records and opening movements reverted atomically.");
      fetchJobs();
    } catch (err: any) {
      error("Undo Error", err.message || "Cannot undo import.");
    }
  };

  const downloadSampleTemplate = () => {
    const blob = new Blob([MARG_SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "marg_erp_migration_template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto select-none">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              Marg ERP 7-Step Migration Wizard
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              Atomic Rollback Capable
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Fuzzy column auto-mapping, pack string normalizer, opening stock ledger generation & 1-click atomic undo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={downloadSampleTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-slate-500 stroke-[2]" />
            <span>Download Marg Template</span>
          </button>

          <button
            onClick={() => parseCsvText("marg_sample_sheet.csv", MARG_SAMPLE_CSV)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Load Marg Sample Data</span>
          </button>
        </div>
      </div>

      {/* 7-Step Progress Pill Strip */}
      <div className="p-3 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
        <div className="flex flex-wrap items-center justify-between text-xs gap-2">
          {[
            { step: "1", title: "Target Master" },
            { step: "2", title: "File Upload" },
            { step: "3", title: "Auto-Mapping" },
            { step: "4", title: "Pack & Expiry Check" },
            { step: "5", title: "Validation Preview" },
            { step: "6", title: "Atomic Commit" },
            { step: "7", title: "Undo History" },
          ].map((s, idx) => (
            <div key={s.step} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-teal-600 text-white flex items-center justify-center font-mono text-[10px] font-bold">
                {s.step}
              </span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{s.title}</span>
              {idx < 6 && <ArrowRight className="w-3 h-3 text-slate-300 ml-1 hidden sm:inline" />}
            </div>
          ))}
        </div>
      </div>

      {/* Step 1 & 2: Select Type & Upload */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm space-y-3">
          <label className="block text-xs font-bold text-navy-900 dark:text-slate-100">
            Step 1: Select Migration Target Master
          </label>
          <select
            value={importType}
            onChange={(e: any) => setImportType(e.target.value)}
            className="w-full h-8 px-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-xs font-semibold focus:outline-none focus:border-teal-500"
          >
            <option value="Opening Stock">Opening Stock + Medicine Master (Batches & Rates)</option>
            <option value="Medicine Master">Medicine Product Master Only</option>
            <option value="Customer Master">Customer Master (Debtors)</option>
            <option value="Supplier Master">Supplier / Stockist Master (Creditors)</option>
          </select>
          <p className="text-[11px] text-slate-400">
            Supports Marg ERP Excel/CSV exports with automatically normalized pack sizes (e.g. 1x10, 1x15) and MM/YY expiries.
          </p>
        </div>

        <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm space-y-3">
          <label className="block text-xs font-bold text-navy-900 dark:text-slate-100">
            Step 2: Upload CSV / Excel Export File
          </label>
          <input
            type="file"
            accept=".csv,.txt"
            onChange={handleFileUpload}
            className="w-full h-8 text-xs file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
          />
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Or click "Load Marg Sample Data" above to test instantly.</span>
          </div>
        </div>
      </div>

      {/* Step 5 & 6: Validation Preview Grid */}
      {parsedRows.length > 0 && (
        <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100 block">
                Validation Preview: {filename}
              </span>
              <span className="text-[11px] text-slate-500">
                {parsedRows.filter((r) => r.status === "OK").length} Valid, {parsedRows.filter((r) => r.status === "ERROR").length} Errors
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setParsedRows([])}
                className="px-3 py-1 text-xs font-medium rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Clear Preview
              </button>
              <button
                onClick={commitImport}
                disabled={committing || parsedRows.filter((r) => r.status === "OK").length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-1 text-xs font-semibold rounded bg-teal-600 hover:bg-teal-700 text-white shadow-sm disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Commit Valid Rows Atomically</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold sticky top-0">
                <tr>
                  <th className="py-2.5 px-2 text-center">Row</th>
                  <th className="py-2.5 px-2 text-center">Status</th>
                  <th className="py-2.5 px-3">Medicine & Salt</th>
                  <th className="py-2.5 px-3">Company</th>
                  <th className="py-2.5 px-2 text-center">Batch</th>
                  <th className="py-2.5 px-2 text-center">Expiry</th>
                  <th className="py-2.5 px-3 text-right">MRP</th>
                  <th className="py-2.5 px-3 text-right">Base Qty</th>
                  <th className="py-2.5 px-3">Validation Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {parsedRows.map((r) => (
                  <tr key={r.rowNum} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2 px-2 text-center font-mono text-slate-400">{r.rowNum}</td>
                    <td className="py-2 px-2 text-center">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          r.status === "OK"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-rose-100 text-rose-800"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-semibold text-navy-900 dark:text-slate-100">
                      {r.name}
                      <div className="text-[10px] text-slate-400">{r.genericName}</div>
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{r.manufacturer}</td>
                    <td className="py-2 px-2 text-center font-mono">{r.batchNo}</td>
                    <td className="py-2 px-2 text-center font-mono">{r.expiryDate}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatINR(r.mrpPaise)}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-teal-700 dark:text-teal-400">
                      {r.qtyBase} TAB
                    </td>
                    <td className="py-2 px-3 text-slate-500">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step 7: Historical Import Jobs & Transactional Undo */}
      <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
          <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
            Import History & 1-Click Rollback Ledger
          </span>
          <span className="text-[10px] text-slate-400 font-mono">Atomic Undo Guarantee</span>
        </div>

        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
            <tr>
              <th className="py-2.5 px-3">Filename</th>
              <th className="py-2.5 px-3">Type</th>
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-2 text-center">Total Rows</th>
              <th className="py-2.5 px-2 text-center">Imported</th>
              <th className="py-2.5 px-2 text-center">Status</th>
              <th className="py-2.5 px-3 text-center">Atomic Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
            {pastJobs.map((j) => (
              <tr key={j.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">{j.filename}</td>
                <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{j.type}</td>
                <td className="py-2.5 px-3 font-mono text-slate-500">{j.created_at.slice(0, 10)}</td>
                <td className="py-2.5 px-2 text-center font-mono">{j.total_rows}</td>
                <td className="py-2.5 px-2 text-center font-mono font-bold text-teal-700 dark:text-teal-400">
                  {j.ok_rows}
                </td>
                <td className="py-2.5 px-2 text-center">
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      j.status === "committed"
                        ? "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {j.status}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-center">
                  {j.status === "committed" ? (
                    <button
                      onClick={() => undoJob(j.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3 stroke-[2]" />
                      <span>Undo Import</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-400">Reverted</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
