"use client";

import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  Search,
  Filter,
  Download,
  Printer,
  Calendar,
  BookOpen,
  User,
  Stethoscope,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface ComplianceRecord {
  id: string;
  date: string;
  invoice_no: string;
  schedule: string;
  item_name: string;
  batch_no: string;
  qty: number;
  patient_name: string;
  patient_address: string;
  doctor_name: string;
  doctor_reg_no: string;
}

export default function ComplianceRegisterPage() {
  const { info, success } = useToast();

  const [records, setRecords] = useState<ComplianceRecord[]>([]);
  const [distinctDoctors, setDistinctDoctors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [scheduleFilter, setScheduleFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (scheduleFilter !== "all") params.set("schedule", scheduleFilter);
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (doctorFilter) params.set("doctorName", doctorFilter);

      const res = await fetch(`/api/compliance?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
        setDistinctDoctors(data.distinctDoctors || []);
      }
    } catch (err) {
      console.error("Failed to load compliance records", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, [scheduleFilter, startDate, endDate, doctorFilter]);

  const filteredRecords = records.filter((r) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.item_name.toLowerCase().includes(q) ||
      r.patient_name.toLowerCase().includes(q) ||
      r.doctor_name.toLowerCase().includes(q) ||
      r.doctor_reg_no.toLowerCase().includes(q) ||
      r.invoice_no.toLowerCase().includes(q) ||
      r.batch_no.toLowerCase().includes(q)
    );
  });

  const exportCSV = () => {
    const headers = [
      "Record ID",
      "Date",
      "Invoice #",
      "Schedule",
      "Medicine Name",
      "Batch #",
      "Qty (Base)",
      "Patient Name",
      "Patient Address",
      "Doctor Name",
      "Doctor Reg No",
    ];
    const rows = filteredRecords.map((r) => [
      r.id,
      r.date,
      r.invoice_no,
      r.schedule,
      `"${r.item_name.replace(/"/g, '""')}"`,
      r.batch_no,
      r.qty,
      `"${r.patient_name.replace(/"/g, '""')}"`,
      `"${r.patient_address.replace(/"/g, '""')}"`,
      `"${r.doctor_name.replace(/"/g, '""')}"`,
      r.doctor_reg_no,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `CDSCO_Schedule_Register_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    success("CSV Exported", "CDSCO Statutory Drug Register CSV downloaded.");
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto select-none">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              CDSCO Statutory Drug Register
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
              Drug Inspector Audit Ready
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Mandatory Schedule H, H1, X, and NDPS register logged automatically during POS counter dispensing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchRecords}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-teal-600" : "text-slate-500"}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={exportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-slate-500 stroke-[2]" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
          >
            <Printer className="w-3.5 h-3.5 stroke-[2]" />
            <span>Print Register</span>
          </button>
        </div>
      </div>

      {/* Filter Strip */}
      <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
          {/* Schedule Selector */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Schedule Category
            </label>
            <select
              value={scheduleFilter}
              onChange={(e) => setScheduleFilter(e.target.value)}
              className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-semibold focus:outline-none focus:border-teal-500"
            >
              <option value="all">All Controlled Schedules</option>
              <option value="H1">Schedule H1</option>
              <option value="H">Schedule H</option>
              <option value="X">Schedule X</option>
              <option value="NDPS">NDPS Narcotics</option>
            </select>
          </div>

          {/* Date Range Start */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              From Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-teal-500"
            />
          </div>

          {/* Date Range End */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              To Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:border-teal-500"
            />
          </div>

          {/* Doctor Filter */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Doctor Name
            </label>
            <input
              type="text"
              placeholder="Filter doctor..."
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="w-full h-8 px-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
            />
          </div>

          {/* Keyword Search */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Search Patient / Medicine
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 pl-7 pr-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
              />
              <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-slate-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Register Table Card */}
      <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
          <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
            Audit Records ({filteredRecords.length})
          </span>
          <span className="text-[10px] text-slate-400 font-mono">Form 20B/21B Compliant</span>
        </div>

        <div className="overflow-x-auto">
          {filteredRecords.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No statutory drug entries found matching the active filters.
            </div>
          ) : (
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Invoice #</th>
                  <th className="py-2.5 px-2 text-center">Schedule</th>
                  <th className="py-2.5 px-3">Medicine Prescribed</th>
                  <th className="py-2.5 px-2 text-center">Batch #</th>
                  <th className="py-2.5 px-2 text-right">Qty</th>
                  <th className="py-2.5 px-3">Patient Name & Address</th>
                  <th className="py-2.5 px-3">Prescribing Doctor & Reg No</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {filteredRecords.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {row.date}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-medium text-teal-700 dark:text-teal-400 whitespace-nowrap">
                      {row.invoice_no}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                          row.schedule === "H1"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                            : row.schedule === "X"
                            ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        {row.schedule}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">
                      {row.item_name}
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono text-slate-700 dark:text-slate-300">
                      {row.batch_no}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                      {row.qty}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-navy-900 dark:text-slate-100">{row.patient_name}</div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{row.patient_address}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-navy-900 dark:text-slate-100">{row.doctor_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">Reg: {row.doctor_reg_no}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
