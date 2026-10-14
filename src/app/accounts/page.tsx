"use client";

import React, { useState, useEffect } from "react";
import {
  FileSpreadsheet,
  Wallet,
  Clock,
  BookOpen,
  Plus,
  RefreshCw,
  Printer,
  DollarSign,
  Send,
  Layers,
  ArrowUpRight,
  TrendingDown,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR, rupeesToPaise } from "@/lib/money";

interface PartyBalance {
  id: string;
  name: string;
  type: string;
  phone: string;
  balancePaise: number;
  nature: "dr" | "cr";
}

interface AgeingBuckets {
  bucket0to30: number;
  bucket31to60: number;
  bucket61to90: number;
  bucket90Plus: number;
  invoices: Array<{
    id: string;
    invoiceNo: string;
    invoiceDate: string;
    customerName: string;
    customerPhone: string;
    duePaise: number;
    daysOld: number;
  }>;
}

interface AccountsData {
  parties: any[];
  partyBalances: PartyBalance[];
  ageingBuckets: AgeingBuckets;
  cashBook: {
    cashSales: number;
    cashPurchases: number;
    cashExpenses: number;
    netCash: number;
  };
  selectedPartyId: string;
  selectedPartyLedger: any[];
  expenses: any[];
}

export default function AccountsPage() {
  const { success, error, warning, info } = useToast();

  const [data, setData] = useState<AccountsData | null>(null);
  const [activeTab, setActiveTab] = useState<"daybook" | "ageing" | "ledger" | "expenses">("daybook");
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [loading, setLoading] = useState(true);

  // New Expense form state
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenseCategory, setExpenseCategory] = useState("Shop Rent");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseMode, setExpenseMode] = useState("cash");
  const [expenseNotes, setExpenseNotes] = useState("");
  const [submittingExpense, setSubmittingExpense] = useState(false);

  const fetchAccounts = async (partyIdParam?: string) => {
    try {
      setLoading(true);
      const url = partyIdParam ? `/api/accounts?partyId=${partyIdParam}` : "/api/accounts";
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setData(json);
        if (!selectedPartyId && json.selectedPartyId) {
          setSelectedPartyId(json.selectedPartyId);
        }
      }
    } catch (err) {
      console.error("Failed to load accounts", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts(selectedPartyId);
  }, [selectedPartyId]);

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const paise = rupeesToPaise(expenseAmount);
    if (paise <= 0) {
      warning("Invalid Amount", "Please enter a valid expense amount.");
      return;
    }

    setSubmittingExpense(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "expense",
          date: expenseDate,
          category: expenseCategory,
          amountPaise: paise,
          mode: expenseMode,
          notes: expenseNotes.trim(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to record expense");
      }

      success("Expense Recorded", "Expense posted to Day Book drawer.");
      setExpenseAmount("");
      setExpenseNotes("");
      fetchAccounts(selectedPartyId);
    } catch (err: any) {
      error("Error", err.message || "Failed to save expense.");
    } finally {
      setSubmittingExpense(false);
    }
  };

  // Build running balance for selected party ledger
  let runningDebit = 0;
  const ledgerRows = (data?.selectedPartyLedger || []).map((le) => {
    runningDebit += Number(le.debit_paise || 0) - Number(le.credit_paise || 0);
    return {
      ...le,
      runningBalancePaise: Math.abs(runningDebit),
      balanceNature: runningDebit >= 0 ? "Dr" : "Cr",
    };
  });

  return (
    <div className="space-y-4 max-w-7xl mx-auto select-none">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              Financial Accounts & Day Book
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              Double-Entry Ledger
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Cash drawer reconciliation, customer credit ageing analysis, and chronological party ledger statements.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchAccounts(selectedPartyId)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-teal-600" : "text-slate-500"}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 hover:bg-slate-50 shadow-sm transition-colors"
          >
            <Printer className="w-3.5 h-3.5 stroke-[2]" />
            <span>Print Ledger</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Cash Drawer Balance
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-teal-700 dark:text-teal-400 tabular-nums">
            {data ? formatINR(data.cashBook.netCash) : "₹0.00"}
          </div>
          <span className="text-[10px] text-slate-400">Sales - Purchases - Expenses</span>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Receivables (Dues)
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-amber-600 dark:text-amber-400 tabular-nums">
            {data
              ? formatINR(
                  data.partyBalances.filter((p) => p.nature === "dr").reduce((s, p) => s + p.balancePaise, 0)
                )
              : "₹0.00"}
          </div>
          <span className="text-[10px] text-slate-400">Customers with outstanding balance</span>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Supplier Payables
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-navy-900 dark:text-slate-100 tabular-nums">
            {data
              ? formatINR(
                  data.partyBalances.filter((p) => p.nature === "cr").reduce((s, p) => s + p.balancePaise, 0)
                )
              : "₹0.00"}
          </div>
          <span className="text-[10px] text-slate-400">Distributor credit dues</span>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Critical Ageing (&gt;60d)
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">
            {data
              ? formatINR(data.ageingBuckets.bucket61to90 + data.ageingBuckets.bucket90Plus)
              : "₹0.00"}
          </div>
          <span className="text-[10px] text-slate-400">Overdue customer credit</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-navy-800">
        <button
          onClick={() => setActiveTab("daybook")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "daybook"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          Cash Book & Day Closing
        </button>
        <button
          onClick={() => setActiveTab("ageing")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "ageing"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Clock className="w-3.5 h-3.5 stroke-[2]" />
          <span>Customer Credit Ageing</span>
        </button>
        <button
          onClick={() => setActiveTab("ledger")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "ledger"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5 stroke-[2]" />
          <span>Party Ledger Statement</span>
        </button>
        <button
          onClick={() => setActiveTab("expenses")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "expenses"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Wallet className="w-3.5 h-3.5 stroke-[2]" />
          <span>Shop Expense Tracker</span>
        </button>
      </div>

      {/* Tab 1: Day Book / Cash Book */}
      {activeTab === "daybook" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase">Cash Sales Inflow</span>
              <div className="mt-1 text-lg font-bold font-mono text-emerald-600">
                +{data ? formatINR(data.cashBook.cashSales) : "₹0.00"}
              </div>
            </div>

            <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase">Cash Purchases Outflow</span>
              <div className="mt-1 text-lg font-bold font-mono text-rose-600">
                -{data ? formatINR(data.cashBook.cashPurchases) : "₹0.00"}
              </div>
            </div>

            <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-xs font-semibold text-slate-500 uppercase">Operating Expenses</span>
              <div className="mt-1 text-lg font-bold font-mono text-amber-600">
                -{data ? formatINR(data.cashBook.cashExpenses) : "₹0.00"}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
                Party Balances (Receivables & Payables)
              </span>
            </div>

            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Party Name</th>
                  <th className="py-2.5 px-2 text-center">Type</th>
                  <th className="py-2.5 px-3">Phone</th>
                  <th className="py-2.5 px-3 text-right">Outstanding Amount</th>
                  <th className="py-2.5 px-2 text-center">Nature</th>
                  <th className="py-2.5 px-3 text-center">Reminder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {data?.partyBalances.map((p) => {
                  const waText = encodeURIComponent(
                    `Namaste ${p.name}, gentle reminder from pharmacy: your account balance of ${formatINR(
                      p.balancePaise
                    )} (${p.nature.toUpperCase()}) is due. Thank you!`
                  );
                  const waUrl = `https://wa.me/91${String(p.phone || "").replace(/\D/g, "")}?text=${waText}`;

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                      <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">{p.name}</td>
                      <td className="py-2.5 px-2 text-center uppercase font-mono text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-navy-700 text-slate-700 dark:text-slate-300">
                          {p.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-500">{p.phone || "—"}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                        {formatINR(p.balancePaise)}
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono font-bold">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                            p.nature === "dr" ? "bg-amber-100 text-amber-800" : "bg-purple-100 text-purple-800"
                          }`}
                        >
                          {p.nature === "dr" ? "Debit (Dr)" : "Credit (Cr)"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {p.phone && p.balancePaise > 0 ? (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                          >
                            <Send className="w-3 h-3 stroke-[2]" />
                            <span>WhatsApp</span>
                          </a>
                        ) : (
                          <span className="text-[11px] text-slate-400">Clear</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Customer Credit Ageing Analysis */}
      {activeTab === "ageing" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase">
                0–30 Days (Current)
              </span>
              <div className="mt-1 text-lg font-bold font-mono text-navy-900 dark:text-slate-100">
                {data ? formatINR(data.ageingBuckets.bucket0to30) : "₹0.00"}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-[11px] font-semibold text-amber-600 uppercase">
                31–60 Days (Due)
              </span>
              <div className="mt-1 text-lg font-bold font-mono text-navy-900 dark:text-slate-100">
                {data ? formatINR(data.ageingBuckets.bucket31to60) : "₹0.00"}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-[11px] font-semibold text-rose-500 uppercase">
                61–90 Days (Overdue)
              </span>
              <div className="mt-1 text-lg font-bold font-mono text-navy-900 dark:text-slate-100">
                {data ? formatINR(data.ageingBuckets.bucket61to90) : "₹0.00"}
              </div>
            </div>

            <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
              <span className="text-[11px] font-semibold text-rose-700 uppercase">
                90+ Days (High Risk)
              </span>
              <div className="mt-1 text-lg font-bold font-mono text-rose-700">
                {data ? formatINR(data.ageingBuckets.bucket90Plus) : "₹0.00"}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30">
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
                Credit Ageing Invoices ({data?.ageingBuckets.invoices.length ?? 0})
              </span>
            </div>

            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Invoice #</th>
                  <th className="py-2.5 px-3">Invoice Date</th>
                  <th className="py-2.5 px-3">Customer Name</th>
                  <th className="py-2.5 px-3">Phone</th>
                  <th className="py-2.5 px-2 text-center">Days Overdue</th>
                  <th className="py-2.5 px-3 text-right">Outstanding Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {data?.ageingBuckets.invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-medium text-teal-700 dark:text-teal-400">
                      {inv.invoiceNo}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{inv.invoiceDate}</td>
                    <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">{inv.customerName}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500">{inv.customerPhone}</td>
                    <td className="py-2.5 px-2 text-center font-mono">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          inv.daysOld > 60
                            ? "bg-rose-100 text-rose-800"
                            : inv.daysOld > 30
                            ? "bg-amber-100 text-amber-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {inv.daysOld} Days
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                      {formatINR(inv.duePaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Party Ledger Statement */}
      {activeTab === "ledger" && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm flex items-center gap-3">
            <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">Select Party:</span>
            <select
              value={selectedPartyId}
              onChange={(e) => setSelectedPartyId(e.target.value)}
              className="h-8 px-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-xs font-semibold max-w-sm focus:outline-none focus:border-teal-500"
            >
              {data?.parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.type.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
                Ledger Entries ({ledgerRows.length})
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Running Balance</span>
            </div>

            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Doc Type</th>
                  <th className="py-2.5 px-3">Reference & Narration</th>
                  <th className="py-2.5 px-3 text-right">Debit (₹)</th>
                  <th className="py-2.5 px-3 text-right">Credit (₹)</th>
                  <th className="py-2.5 px-3 text-right">Running Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {ledgerRows.map((le) => (
                  <tr key={le.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-slate-500">{le.date}</td>
                    <td className="py-2.5 px-3 font-mono font-medium text-slate-700 dark:text-slate-300">
                      {le.doc_type}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-navy-900 dark:text-slate-100">{le.doc_id}</div>
                      <div className="text-[10px] text-slate-400">{le.narration}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {le.debit_paise > 0 ? formatINR(le.debit_paise) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {le.credit_paise > 0 ? formatINR(le.credit_paise) : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                      {formatINR(le.runningBalancePaise)} {le.balanceNature}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Shop Expense Tracker */}
      {activeTab === "expenses" && (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
            <span className="text-xs font-bold text-navy-900 dark:text-slate-100 block mb-3">
              Record Shop Operating Expense
            </span>
            <form onSubmit={handleExpenseSubmit} className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Date *
                </label>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Category *
                </label>
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 font-medium"
                >
                  <option value="Shop Rent">Shop Rent</option>
                  <option value="Electricity & Cold Chain">Electricity & Cold Chain</option>
                  <option value="Staff Salary">Staff Salary</option>
                  <option value="Delivery Freight">Delivery & Freight</option>
                  <option value="Packaging & Paper">Packaging & Paper</option>
                  <option value="Miscellaneous">Miscellaneous</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Amount (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 500.00"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Payment Mode
                </label>
                <select
                  value={expenseMode}
                  onChange={(e) => setExpenseMode(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900"
                >
                  <option value="cash">Cash Out</option>
                  <option value="upi">UPI / Bank</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={submittingExpense}
                  className="w-full h-8 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-sm transition-colors disabled:opacity-50"
                >
                  Post Expense
                </button>
              </div>
            </form>
          </div>

          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30">
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
                Recent Expenses Ledger
              </span>
            </div>

            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-2 text-center">Mode</th>
                  <th className="py-2.5 px-3">Notes</th>
                  <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {data?.expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2.5 px-3 font-mono text-slate-500">{e.date}</td>
                    <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">{e.category}</td>
                    <td className="py-2.5 px-2 text-center uppercase font-mono text-[10px]">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-navy-700 text-slate-700 dark:text-slate-300">
                        {e.mode}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-500">{e.notes || "—"}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600">
                      {formatINR(e.amount_paise)}
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
