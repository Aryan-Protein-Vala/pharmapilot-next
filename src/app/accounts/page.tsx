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
  Send,
  Layers,
  Search,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  CreditCard,
  Lock,
  Unlock,
  Calendar,
  FileText,
  Receipt,
  Coins,
  ChevronRight,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR, rupeesToPaise, paiseToRupeesStr } from "@/lib/money";
import { AddCustomerModal } from "@/components/pos/AddCustomerModal";

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

interface KhataCustomer {
  id: string;
  name: string;
  phone: string;
  address: string;
  creditLimitPaise: number;
  openingBalancePaise: number;
  openingBalanceType: string;
  totalDebitPaise: number;
  totalCreditPaise: number;
  balancePaise: number;
  nature: "dr" | "cr";
  unpaidBillsCount: number;
  oldestDueDays: number;
  status: "clear" | "active" | "overdue" | "limit_exceeded";
}

interface KhataData {
  customers: KhataCustomer[];
  selectedCustomer: any;
  invoices: any[];
  receipts: any[];
  ledgerEntries: any[];
  summary: {
    totalCustomers: number;
    customersWithDue: number;
    totalOutstandingPaise: number;
    totalOverduePaise: number;
  };
}

interface DayClosingData {
  closingDate: string;
  billCount: number;
  sales: {
    cashSalesPaise: number;
    upiSalesPaise: number;
    cardSalesPaise: number;
    creditSalesPaise: number;
    totalSalesPaise: number;
  };
  khataReceipts: {
    cashPaise: number;
    upiPaise: number;
    totalPaise: number;
  };
  expenses: {
    cashPaise: number;
    totalPaise: number;
  };
  purchases: {
    cashPaise: number;
  };
  expectedCashPaise: number;
  isClosed: boolean;
  existingClosing: any;
  recentClosings: any[];
}

export default function AccountsPage() {
  const { success, error, warning, info } = useToast();

  const [activeTab, setActiveTab] = useState<
    "khata" | "closing" | "daybook" | "ageing" | "ledger" | "expenses"
  >("khata");
  const [loading, setLoading] = useState(true);

  // General accounts data
  const [data, setData] = useState<AccountsData | null>(null);
  const [selectedPartyId, setSelectedPartyId] = useState("");

  // Customer Khata state
  const [khataData, setKhataData] = useState<KhataData | null>(null);
  const [khataLoading, setKhataLoading] = useState(false);
  const [khataSearch, setKhataSearch] = useState("");
  const [khataFilter, setKhataFilter] = useState<"all" | "dues" | "overdue" | "exceeded">("dues");
  const [activeKhataCustomerId, setActiveKhataCustomerId] = useState("");
  const [showCustomerDrawer, setShowCustomerDrawer] = useState(false);
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);

  // Record Payment Modal State
  const [paymentCustomer, setPaymentCustomer] = useState<KhataCustomer | null>(null);
  const [paymentAmountRupees, setPaymentAmountRupees] = useState("");
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "bank">("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Receipt Modal State
  const [receiptData, setReceiptData] = useState<any | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // Day Closing State
  const [closingDate, setClosingDate] = useState(new Date().toISOString().slice(0, 10));
  const [closingData, setClosingData] = useState<DayClosingData | null>(null);
  const [closingLoading, setClosingLoading] = useState(false);
  const [physicalCashRupees, setPhysicalCashRupees] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [lockingClose, setLockingClose] = useState(false);
  const [closingPrintRecord, setClosingPrintRecord] = useState<any | null>(null);

  // Expense form state
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenseCategory, setExpenseCategory] = useState("Shop Rent");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseMode, setExpenseMode] = useState("cash");
  const [expenseNotes, setExpenseNotes] = useState("");
  const [submittingExpense, setSubmittingExpense] = useState(false);

  // Fetch Accounts Base Data
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

  // Fetch Khata Data
  const fetchKhata = async (customerId?: string) => {
    try {
      setKhataLoading(true);
      const url = customerId ? `/api/accounts/khata?customerId=${customerId}` : "/api/accounts/khata";
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setKhataData(json);
        if (customerId && json.selectedCustomer) {
          setActiveKhataCustomerId(customerId);
        } else if (!activeKhataCustomerId && json.selectedCustomer) {
          setActiveKhataCustomerId(json.selectedCustomer.id);
        }
      }
    } catch (err) {
      console.error("Failed to load khata data", err);
    } finally {
      setKhataLoading(false);
    }
  };

  // Fetch Day Closing Data
  const fetchDayClosing = async (dateParam?: string) => {
    try {
      setClosingLoading(true);
      const targetDate = dateParam || closingDate;
      const res = await fetch(`/api/accounts/day-closing?date=${targetDate}`);
      if (res.ok) {
        const json = await res.json();
        setClosingData(json);
        if (json.isClosed && json.existingClosing) {
          setPhysicalCashRupees(paiseToRupeesStr(json.existingClosing.cash_physical_paise));
          setClosingNotes(json.existingClosing.notes || "");
        } else {
          setPhysicalCashRupees("");
          setClosingNotes("");
        }
      }
    } catch (err) {
      console.error("Failed to load closing data", err);
    } finally {
      setClosingLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts(selectedPartyId);
    fetchKhata();
    fetchDayClosing(closingDate);
  }, []);

  const handleSelectCustomerForDrawer = (cust: KhataCustomer) => {
    setActiveKhataCustomerId(cust.id);
    fetchKhata(cust.id);
    setShowCustomerDrawer(true);
  };

  const handleOpenPaymentModal = (cust: KhataCustomer) => {
    setPaymentCustomer(cust);
    setPaymentAmountRupees(paiseToRupeesStr(cust.balancePaise));
    setPaymentMode("cash");
    setPaymentReference("");
    setPaymentNotes("");
  };

  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentCustomer) return;
    const amountPaise = rupeesToPaise(paymentAmountRupees);
    if (amountPaise <= 0) {
      warning("Invalid Amount", "Please enter a valid payment amount greater than zero.");
      return;
    }

    try {
      setSubmittingPayment(true);
      const res = await fetch("/api/accounts/khata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: paymentCustomer.id,
          amountPaise,
          mode: paymentMode,
          reference: paymentReference.trim(),
          notes: paymentNotes.trim(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to record payment");
      }

      const receipt = await res.json();
      success(
        "Payment Recorded",
        `Receipt #${receipt.receiptNo} created for ${paymentCustomer.name}. Balance: ${formatINR(
          receipt.updatedBalancePaise
        )}`
      );

      setReceiptData({
        ...receipt,
        customerAddress: paymentCustomer.address,
      });
      setPaymentCustomer(null);
      setShowReceiptModal(true);

      // Refresh data
      fetchKhata(paymentCustomer.id);
      fetchAccounts(selectedPartyId);
      fetchDayClosing(closingDate);
    } catch (err: any) {
      error("Payment Failed", err.message || "Failed to record customer payment");
    } finally {
      setSubmittingPayment(false);
    }
  };

  const handleLockDayClose = async () => {
    if (!closingData) return;
    const physicalCashPaise = rupeesToPaise(physicalCashRupees || "0");
    if (physicalCashPaise < 0) {
      warning("Invalid Amount", "Please enter physical cash counted.");
      return;
    }

    try {
      setLockingClose(true);
      const res = await fetch("/api/accounts/day-closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closingDate,
          cashPhysicalPaise: physicalCashPaise,
          notes: closingNotes.trim(),
          closedBy: "user_owner",
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to save day closing");
      }

      const saved = await res.json();
      const disc = saved.cashDiscrepancyPaise;
      const statusText =
        disc === 0
          ? "Balanced (Zero Discrepancy)"
          : disc < 0
          ? `Shortage of ${formatINR(Math.abs(disc))}`
          : `Surplus of ${formatINR(disc)}`;

      success("Day Close Saved", `Closing record locked for ${closingDate}. Galla: ${statusText}`);

      setClosingPrintRecord({
        ...saved,
        summary: closingData,
      });
      fetchDayClosing(closingDate);
    } catch (err: any) {
      error("Day Close Error", err.message || "Failed to save day closing");
    } finally {
      setLockingClose(false);
    }
  };

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
      fetchDayClosing(closingDate);
    } catch (err: any) {
      error("Error", err.message || "Failed to save expense.");
    } finally {
      setSubmittingExpense(false);
    }
  };

  // Filtered Khata Customers
  const filteredKhataCustomers = (khataData?.customers || []).filter((c) => {
    const q = khataSearch.toLowerCase().trim();
    const matchesSearch =
      !q || c.name.toLowerCase().includes(q) || c.phone.replace(/\D/g, "").includes(q);
    if (!matchesSearch) return false;

    if (khataFilter === "dues") return c.balancePaise > 0 && c.nature === "dr";
    if (khataFilter === "overdue") return c.oldestDueDays > 30 && c.balancePaise > 0;
    if (khataFilter === "exceeded") return c.status === "limit_exceeded";
    return true;
  });

  // Running balance for selected party ledger
  let runningDebit = 0;
  const ledgerRows = (data?.selectedPartyLedger || []).map((le) => {
    runningDebit += Number(le.debit_paise || 0) - Number(le.credit_paise || 0);
    return {
      ...le,
      runningBalancePaise: Math.abs(runningDebit),
      balanceNature: runningDebit >= 0 ? "Dr" : "Cr",
    };
  });

  // Calculate live discrepancy for Daily Closing
  const expectedPaise = closingData?.expectedCashPaise || 0;
  const physicalPaise = rupeesToPaise(physicalCashRupees || "0");
  const discrepancyPaise = physicalPaise - expectedPaise;

  return (
    <div className="space-y-4 max-w-7xl mx-auto select-none">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              Financial Accounts & Udhar Book
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              Chemist ERP Ledgers
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Customer Udhar credit book, daily counter cash closing (Galla), cash reconciliation, and party statements.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchAccounts(selectedPartyId);
              fetchKhata(activeKhataCustomerId);
              fetchDayClosing(closingDate);
            }}
            disabled={loading || khataLoading || closingLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                loading || khataLoading || closingLoading ? "animate-spin text-teal-600" : "text-slate-500"
              }`}
            />
            <span>Sync</span>
          </button>

          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm transition-colors"
          >
            <Printer className="w-3.5 h-3.5 stroke-[2]" />
            <span>Print View</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total Customer Udhar (Khata)
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-amber-600 dark:text-amber-400 tabular-nums">
            {formatINR(khataData?.summary.totalOutstandingPaise || 0)}
          </div>
          <span className="text-[10px] text-slate-400">
            {khataData?.summary.customersWithDue || 0} customers with active dues
          </span>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Critical Overdue (&gt;30 Days)
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-rose-600 dark:text-rose-400 tabular-nums">
            {formatINR(khataData?.summary.totalOverduePaise || 0)}
          </div>
          <span className="text-[10px] text-slate-400">Immediate recovery attention needed</span>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Today Expected Galla Cash
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-teal-700 dark:text-teal-400 tabular-nums">
            {formatINR(closingData?.expectedCashPaise || 0)}
          </div>
          <span className="text-[10px] text-slate-400">Sales + Khata Receipts - Expenses</span>
        </div>

        <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Today Total Turnover
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-navy-900 dark:text-slate-100 tabular-nums">
            {formatINR(closingData?.sales.totalSalesPaise || 0)}
          </div>
          <span className="text-[10px] text-slate-400">{closingData?.billCount || 0} bills today</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-navy-800 overflow-x-auto">
        <button
          onClick={() => setActiveTab("khata")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === "khata"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5 stroke-[2]" />
          <span>Customer Khata (Udhar Book)</span>
          {khataData && (
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-800 font-mono">
              {khataData.summary.customersWithDue}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("closing")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === "closing"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Coins className="w-3.5 h-3.5 stroke-[2]" />
          <span>Daily Galla Closing</span>
          {closingData?.isClosed ? (
            <span className="ml-1 px-1.5 py-0.2 rounded text-[10px] bg-emerald-100 text-emerald-800">
              Locked
            </span>
          ) : (
            <span className="ml-1 px-1.5 py-0.2 rounded text-[10px] bg-amber-100 text-amber-800">
              Open
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("daybook")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === "daybook"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <FileSpreadsheet className="w-3.5 h-3.5 stroke-[2]" />
          <span>Cash Book & Drawer</span>
        </button>

        <button
          onClick={() => setActiveTab("ageing")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
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
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === "ledger"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Layers className="w-3.5 h-3.5 stroke-[2]" />
          <span>Party Ledger Statement</span>
        </button>

        <button
          onClick={() => setActiveTab("expenses")}
          className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === "expenses"
              ? "border-teal-600 text-teal-700 dark:text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Wallet className="w-3.5 h-3.5 stroke-[2]" />
          <span>Shop Expense Tracker</span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: CUSTOMER KHATA (UDHAR REGISTER)                                */}
      {/* ==================================================================== */}
      {activeTab === "khata" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search regular customer by name or 10-digit phone..."
                value={khataSearch}
                onChange={(e) => setKhataSearch(e.target.value)}
                className="w-full h-8 pl-8 pr-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setKhataFilter("dues")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  khataFilter === "dues"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-semibold"
                    : "bg-slate-100 dark:bg-navy-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                }`}
              >
                With Dues Only
              </button>
              <button
                onClick={() => setKhataFilter("overdue")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  khataFilter === "overdue"
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 font-semibold"
                    : "bg-slate-100 dark:bg-navy-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                }`}
              >
                Overdue (&gt;30d)
              </button>
              <button
                onClick={() => setKhataFilter("exceeded")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  khataFilter === "exceeded"
                    ? "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 font-semibold"
                    : "bg-slate-100 dark:bg-navy-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                }`}
              >
                Limit Exceeded
              </button>
              <button
                onClick={() => setKhataFilter("all")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  khataFilter === "all"
                    ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 font-semibold"
                    : "bg-slate-100 dark:bg-navy-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                }`}
              >
                All Customers
              </button>

              <button
                type="button"
                onClick={() => setShowAddCustomerModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-xs transition-colors shrink-0 ml-2"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>+ Add Customer</span>
              </button>
            </div>
          </div>

          {/* Customers Table */}
          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
                Customer Udhar Ledger ({filteredKhataCustomers.length})
              </span>
              <span className="text-[10px] text-slate-400">
                Regular customer khata balances with credit limits
              </span>
            </div>

            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Customer Name</th>
                  <th className="py-2.5 px-3">Phone</th>
                  <th className="py-2.5 px-3 text-right">Credit Limit</th>
                  <th className="py-2.5 px-3 text-right">Outstanding Balance</th>
                  <th className="py-2.5 px-2 text-center">Status</th>
                  <th className="py-2.5 px-3 text-center">Quick Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {filteredKhataCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No customer khata records matching current filters.
                    </td>
                  </tr>
                ) : (
                  filteredKhataCustomers.map((c) => {
                    const cleanPhone = String(c.phone || "").replace(/\D/g, "");
                    const waMessage = encodeURIComponent(
                      `Namaste ${c.name}, this is a gentle reminder from PharmaPilot Pharmacy regarding your outstanding Udhar Khata balance of ${formatINR(
                        c.balancePaise
                      )}. Kindly clear the due at the counter or via UPI. Thank you!`
                    );
                    const waUrl = `https://wa.me/91${cleanPhone}?text=${waMessage}`;

                    return (
                      <tr
                        key={c.id}
                        className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors cursor-pointer"
                        onClick={() => handleSelectCustomerForDrawer(c)}
                      >
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-navy-900 dark:text-slate-100">
                            {c.name}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate max-w-[200px]">
                            {c.address || "Colony Resident"}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                          {c.phone || "—"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                          {c.creditLimitPaise > 0 ? formatINR(c.creditLimitPaise) : "No Limit"}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                          <span
                            className={
                              c.balancePaise > 0 && c.nature === "dr"
                                ? "text-amber-700 dark:text-amber-400 font-extrabold"
                                : "text-emerald-700 dark:text-emerald-400"
                            }
                          >
                            {formatINR(c.balancePaise)}
                          </span>
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          {c.status === "clear" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                              Clear
                            </span>
                          )}
                          {c.status === "active" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300">
                              Within Limit
                            </span>
                          )}
                          {c.status === "limit_exceeded" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                              Credit Exceeded
                            </span>
                          )}
                          {c.status === "overdue" && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                              Overdue ({c.oldestDueDays}d)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            {c.balancePaise > 0 && (
                              <button
                                onClick={() => handleOpenPaymentModal(c)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-teal-600 hover:bg-teal-700 text-white shadow-xs transition-colors"
                              >
                                <Plus className="w-3 h-3 stroke-[2.5]" />
                                <span>Record Payment</span>
                              </button>
                            )}

                            {cleanPhone && c.balancePaise > 0 ? (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 transition-colors"
                              >
                                <Send className="w-3 h-3 stroke-[2]" />
                                <span>WhatsApp</span>
                              </a>
                            ) : null}

                            <button
                              onClick={() => handleSelectCustomerForDrawer(c)}
                              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                              title="View Ledger Statement"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: DAILY GALLA CLOSING (DAY-END CASH RECONCILIATION)               */}
      {/* ==================================================================== */}
      {activeTab === "closing" && (
        <div className="space-y-4">
          {/* Date Selector Header */}
          <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Closing Date:
              </label>
              <input
                type="date"
                value={closingDate}
                onChange={(e) => {
                  setClosingDate(e.target.value);
                  fetchDayClosing(e.target.value);
                }}
                className="h-8 px-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-xs font-mono font-semibold"
              />
              <span className="text-xs text-slate-400 font-mono">
                {closingData?.billCount || 0} Bills Logged
              </span>
            </div>

            <div className="flex items-center gap-2">
              {closingData?.isClosed ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                  <Lock className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Day Close Locked</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                  <Unlock className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>Drawer Open & Reconciling</span>
                </div>
              )}

              {closingData?.isClosed && (
                <button
                  onClick={() =>
                    setClosingPrintRecord({
                      ...closingData.existingClosing,
                      summary: closingData,
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Slip</span>
                </button>
              )}
            </div>
          </div>

          {/* Breakdown Panels */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Column 1: Cash Inflow Breakdown */}
            <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-navy-700">
                <span className="text-xs font-bold text-navy-900 dark:text-slate-100 uppercase tracking-wider">
                  Cash Inflow & Outflow
                </span>
                <Coins className="w-4 h-4 text-teal-600" />
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-50 dark:border-navy-750">
                  <span className="text-slate-600 dark:text-slate-400">Cash Sales Inflow</span>
                  <span className="font-mono font-semibold text-emerald-600">
                    +{formatINR(closingData?.sales.cashSalesPaise || 0)}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-50 dark:border-navy-750">
                  <span className="text-slate-600 dark:text-slate-400">Customer Khata Cash Receipts</span>
                  <span className="font-mono font-semibold text-emerald-600">
                    +{formatINR(closingData?.khataReceipts.cashPaise || 0)}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-50 dark:border-navy-750">
                  <span className="text-slate-600 dark:text-slate-400">Operating Expenses Outflow</span>
                  <span className="font-mono font-semibold text-rose-600">
                    -{formatINR(closingData?.expenses.cashPaise || 0)}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-50 dark:border-navy-750">
                  <span className="text-slate-600 dark:text-slate-400">Supplier Cash Purchases Outflow</span>
                  <span className="font-mono font-semibold text-rose-600">
                    -{formatINR(closingData?.purchases.cashPaise || 0)}
                  </span>
                </div>

                <div className="pt-2 flex justify-between font-bold text-sm bg-slate-50 dark:bg-navy-900/40 p-2 rounded">
                  <span className="text-navy-900 dark:text-slate-100">Expected Cash In Drawer</span>
                  <span className="font-mono text-teal-700 dark:text-teal-400">
                    {formatINR(expectedPaise)}
                  </span>
                </div>
              </div>
            </div>

            {/* Column 2: Digital & Credit Sales Summary */}
            <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-navy-700">
                <span className="text-xs font-bold text-navy-900 dark:text-slate-100 uppercase tracking-wider">
                  Digital Collections & Credit
                </span>
                <CreditCard className="w-4 h-4 text-sky-600" />
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-50 dark:border-navy-750">
                  <span className="text-slate-600 dark:text-slate-400">UPI Counter Sales</span>
                  <span className="font-mono font-semibold text-sky-600">
                    {formatINR(closingData?.sales.upiSalesPaise || 0)}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-50 dark:border-navy-750">
                  <span className="text-slate-600 dark:text-slate-400">Customer Khata UPI Receipts</span>
                  <span className="font-mono font-semibold text-sky-600">
                    {formatINR(closingData?.khataReceipts.upiPaise || 0)}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-50 dark:border-navy-750">
                  <span className="text-slate-600 dark:text-slate-400">Card POS Sales</span>
                  <span className="font-mono font-semibold text-purple-600">
                    {formatINR(closingData?.sales.cardSalesPaise || 0)}
                  </span>
                </div>

                <div className="flex justify-between py-1 border-b border-slate-50 dark:border-navy-750">
                  <span className="text-slate-600 dark:text-slate-400">Customer Credit Sales (Udhar)</span>
                  <span className="font-mono font-semibold text-amber-600">
                    {formatINR(closingData?.sales.creditSalesPaise || 0)}
                  </span>
                </div>

                <div className="pt-2 flex justify-between font-bold text-sm bg-slate-50 dark:bg-navy-900/40 p-2 rounded">
                  <span className="text-navy-900 dark:text-slate-100">Total Counter Sales</span>
                  <span className="font-mono text-navy-900 dark:text-slate-100">
                    {formatINR(closingData?.sales.totalSalesPaise || 0)}
                  </span>
                </div>
              </div>
            </div>

            {/* Column 3: Physical Count & Discrepancy Lock */}
            <div className="p-4 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-navy-700">
                <span className="text-xs font-bold text-navy-900 dark:text-slate-100 uppercase tracking-wider">
                  Counter Galla Reconciliation
                </span>
                <Lock className="w-4 h-4 text-amber-600" />
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Physical Cash in Drawer (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Enter physical cash counted in drawer"
                    value={physicalCashRupees}
                    onChange={(e) => setPhysicalCashRupees(e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-slate-300 dark:border-navy-600 bg-white dark:bg-navy-900 text-base font-mono font-bold text-navy-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>

                {/* Instant Discrepancy Indicator Badge */}
                {physicalCashRupees !== "" && (
                  <div
                    className={`p-3 rounded-lg border text-xs ${
                      discrepancyPaise === 0
                        ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                        : discrepancyPaise < 0
                        ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-300"
                        : "bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-800 text-sky-900 dark:text-sky-300"
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span className="flex items-center gap-1.5">
                        {discrepancyPaise === 0 && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                        {discrepancyPaise < 0 && <AlertTriangle className="w-4 h-4 text-amber-600" />}
                        {discrepancyPaise > 0 && <TrendingUp className="w-4 h-4 text-sky-600" />}
                        {discrepancyPaise === 0
                          ? "Galla Balanced (Exact Match)"
                          : discrepancyPaise < 0
                          ? "Cash Shortage (Deficit)"
                          : "Cash Excess (Surplus)"}
                      </span>
                      <span className="font-mono text-sm">
                        {discrepancyPaise === 0
                          ? "₹0.00"
                          : discrepancyPaise < 0
                          ? `-${formatINR(Math.abs(discrepancyPaise))}`
                          : `+${formatINR(discrepancyPaise)}`}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] opacity-80">
                      {discrepancyPaise === 0
                        ? "Physical drawer cash perfectly matches software ledger calculation."
                        : discrepancyPaise < 0
                        ? "Drawer has less cash than expected. Record reason in notes below."
                        : "Drawer has excess cash compared to recorded invoices."}
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Discrepancy Justification / Notes
                  </label>
                  <textarea
                    rows={2}
                    placeholder="e.g. ₹50 change short given by morning staff, verified."
                    value={closingNotes}
                    onChange={(e) => setClosingNotes(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
                  />
                </div>

                <button
                  onClick={handleLockDayClose}
                  disabled={lockingClose || physicalCashRupees === ""}
                  className="w-full h-9 rounded-md bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-sm transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{closingData?.isClosed ? "Update Day Close & Print" : "Lock Day Close & Print Summary"}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Past Closing History Log */}
          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30 flex items-center justify-between">
              <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
                Recent Daily Galla Closings Log
              </span>
              <span className="text-[10px] text-slate-400 font-mono">Audit Register</span>
            </div>

            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-2 text-center">Time</th>
                  <th className="py-2.5 px-3 text-right">System Expected Cash</th>
                  <th className="py-2.5 px-3 text-right">Physical Cash</th>
                  <th className="py-2.5 px-3 text-right">Discrepancy</th>
                  <th className="py-2.5 px-3 text-right">Total Sales</th>
                  <th className="py-2.5 px-3">Notes</th>
                  <th className="py-2.5 px-2 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {closingData?.recentClosings.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-400">
                      No past day closings recorded yet. Lock your first day close above.
                    </td>
                  </tr>
                ) : (
                  closingData?.recentClosings.map((c) => {
                    const disc = Number(c.cash_discrepancy_paise);
                    return (
                      <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-medium text-teal-700 dark:text-teal-400">
                          {c.closing_date}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-slate-400">
                          {c.closing_time}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {formatINR(c.cash_system_paise)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                          {formatINR(c.cash_physical_paise)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                          <span
                            className={
                              disc === 0
                                ? "text-emerald-600"
                                : disc < 0
                                ? "text-amber-600"
                                : "text-sky-600"
                            }
                          >
                            {disc === 0
                              ? "₹0.00"
                              : disc < 0
                              ? `-${formatINR(Math.abs(disc))}`
                              : `+${formatINR(disc)}`}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {formatINR(c.total_sales_paise)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate">
                          {c.notes || "—"}
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <button
                            onClick={() =>
                              setClosingPrintRecord({
                                ...c,
                                summary: closingData,
                              })
                            }
                            className="p-1 rounded text-slate-500 hover:text-teal-600 transition-colors"
                            title="Print Closing Certificate"
                          >
                            <Printer className="w-3.5 h-3.5 stroke-[2]" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: CASH BOOK & DRAWER (DAY BOOK)                                  */}
      {/* ==================================================================== */}
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

      {/* ==================================================================== */}
      {/* TAB 4: CUSTOMER CREDIT AGEING ANALYSIS                                */}
      {/* ==================================================================== */}
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

      {/* ==================================================================== */}
      {/* TAB 5: PARTY LEDGER STATEMENT                                         */}
      {/* ==================================================================== */}
      {activeTab === "ledger" && (
        <div className="space-y-3">
          <div className="p-3.5 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm flex items-center gap-3">
            <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">Select Party:</span>
            <select
              value={selectedPartyId}
              onChange={(e) => {
                setSelectedPartyId(e.target.value);
                fetchAccounts(e.target.value);
              }}
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

      {/* ==================================================================== */}
      {/* TAB 6: SHOP EXPENSE TRACKER                                          */}
      {/* ==================================================================== */}
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

      {/* ==================================================================== */}
      {/* MODAL 1: RECORD CUSTOMER PAYMENT ("Sharma ji paid ₹500")              */}
      {/* ==================================================================== */}
      {paymentCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-navy-800 p-5 shadow-2xl border border-slate-200 dark:border-navy-700">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-navy-700">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-teal-600 stroke-[2]" />
                <h3 className="text-sm font-bold text-navy-900 dark:text-slate-100">
                  Record Customer Udhar Payment
                </h3>
              </div>
              <button
                onClick={() => setPaymentCustomer(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitPayment} className="mt-4 space-y-3.5 text-xs">
              <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-bold text-teal-900 dark:text-teal-200 text-sm">
                      {paymentCustomer.name}
                    </span>
                    <span className="block text-[11px] font-mono text-teal-700 dark:text-teal-400">
                      {paymentCustomer.phone || "No phone registered"}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-teal-600 uppercase font-semibold">Total Due</span>
                    <div className="font-mono text-base font-bold text-amber-700 dark:text-amber-400">
                      {formatINR(paymentCustomer.balancePaise)}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Amount Received (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 500.00"
                  value={paymentAmountRupees}
                  onChange={(e) => setPaymentAmountRupees(e.target.value)}
                  className="w-full h-10 px-3 rounded-md border border-slate-300 dark:border-navy-600 bg-white dark:bg-navy-900 text-base font-mono font-bold text-navy-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
                />

                {/* Quick Fill Chips */}
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setPaymentAmountRupees(paiseToRupeesStr(paymentCustomer.balancePaise))}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-800 hover:bg-teal-200 transition-colors"
                  >
                    Full Balance
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentAmountRupees("500")}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-navy-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200"
                  >
                    ₹500
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentAmountRupees("1000")}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-navy-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200"
                  >
                    ₹1,000
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentAmountRupees("2000")}
                    className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-navy-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200"
                  >
                    ₹2,000
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMode("cash")}
                  className={`h-9 rounded-md border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    paymentMode === "cash"
                      ? "border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300"
                      : "border-slate-200 dark:border-navy-700 hover:bg-slate-50"
                  }`}
                >
                  <Coins className="w-3.5 h-3.5" />
                  <span>Cash</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMode("upi")}
                  className={`h-9 rounded-md border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    paymentMode === "upi"
                      ? "border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300"
                      : "border-slate-200 dark:border-navy-700 hover:bg-slate-50"
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>UPI GPay</span>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMode("bank")}
                  className={`h-9 rounded-md border text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    paymentMode === "bank"
                      ? "border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300"
                      : "border-slate-200 dark:border-navy-700 hover:bg-slate-50"
                  }`}
                >
                  <Wallet className="w-3.5 h-3.5" />
                  <span>Bank NEFT</span>
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  UTR / Reference (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. UPI-93821039 or Cheque #00129"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 font-mono text-xs focus:outline-none focus:border-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Narration / Chemist Note
                </label>
                <input
                  type="text"
                  placeholder="e.g. Paid in morning by patient's son"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                  className="w-full h-8 px-2.5 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-xs focus:outline-none focus:border-teal-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-navy-700">
                <button
                  type="button"
                  onClick={() => setPaymentCustomer(null)}
                  className="px-3.5 py-1.5 rounded-md border border-slate-200 dark:border-navy-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPayment}
                  className="px-4 py-1.5 rounded-md bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Confirm Receipt & Update Ledger</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: PRINTABLE PAYMENT RECEIPT                                   */}
      {/* ==================================================================== */}
      {showReceiptModal && receiptData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl border border-slate-200 text-slate-900 font-sans">
            <div className="text-center pb-3 border-b border-dashed border-slate-300">
              <h3 className="text-sm font-bold tracking-tight uppercase">PharmaPilot Wellness Pharmacy</h3>
              <p className="text-[10px] text-slate-500">Retail Chemist & Druggist · GSTIN: 29AABCU9603R1ZM</p>
              <div className="mt-1 inline-block px-2 py-0.5 rounded bg-slate-100 text-[10px] font-mono font-bold uppercase">
                Official Cash / Udhar Receipt
              </div>
            </div>

            <div className="py-3 space-y-1.5 text-xs font-mono border-b border-dashed border-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-500">Receipt No:</span>
                <span className="font-bold">{receiptData.receiptNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Date:</span>
                <span>{receiptData.date}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Customer:</span>
                <span className="font-bold text-right">{receiptData.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Mode:</span>
                <span className="uppercase font-semibold">{receiptData.mode}</span>
              </div>
            </div>

            <div className="py-3 border-b border-dashed border-slate-300 space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="font-bold text-slate-700">Amount Received:</span>
                <span className="font-mono text-base font-bold text-teal-700">
                  {formatINR(receiptData.amountPaise)}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs text-slate-600 font-mono">
                <span>Remaining Khata Due:</span>
                <span className="font-bold">
                  {formatINR(receiptData.updatedBalancePaise)}
                </span>
              </div>
            </div>

            <div className="pt-3 text-center text-[10px] text-slate-400">
              Thank you for clearing your balance. Valid system generated receipt.
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowReceiptModal(false)}
                className="px-3 py-1 text-xs rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="px-3.5 py-1 text-xs font-semibold rounded bg-teal-600 text-white hover:bg-teal-700 shadow-sm flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Receipt</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: PRINTABLE DAY-END CLOSING CERTIFICATE                        */}
      {/* ==================================================================== */}
      {closingPrintRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl border border-slate-200 text-slate-900 font-sans">
            <div className="flex justify-between items-start pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-base font-bold tracking-tight uppercase">
                  Daily Counter Galla Closing Certificate
                </h3>
                <p className="text-xs text-slate-500">PharmaPilot Wellness Pharmacy · Day-End Audit</p>
              </div>
              <button
                onClick={() => setClosingPrintRecord(null)}
                className="p-1 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-3 space-y-2 text-xs font-mono border-b border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-500">Closing Date:</span>
                <span className="font-bold">{closingPrintRecord.closing_date || closingPrintRecord.closingDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Closing Time:</span>
                <span>{closingPrintRecord.closing_time || closingPrintRecord.closingTime}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Closed By:</span>
                <span className="font-semibold">{closingPrintRecord.closed_by || closingPrintRecord.closedBy || "Owner / Cashier"}</span>
              </div>
            </div>

            <div className="py-3 space-y-2 text-xs font-mono border-b border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-600">Total Counter Sales:</span>
                <span className="font-bold">{formatINR(closingPrintRecord.total_sales_paise || closingPrintRecord.totalSalesPaise || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">UPI Counter Collections:</span>
                <span>{formatINR(closingPrintRecord.upi_system_paise || closingPrintRecord.upiSystemPaise || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Card Counter Collections:</span>
                <span>{formatINR(closingPrintRecord.card_system_paise || closingPrintRecord.cardSystemPaise || 0)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Credit Sales Given (Udhar):</span>
                <span>{formatINR(closingPrintRecord.credit_system_paise || closingPrintRecord.creditSystemPaise || 0)}</span>
              </div>
            </div>

            <div className="py-3 space-y-2 text-xs font-mono bg-slate-50 p-3 rounded-lg border border-slate-100">
              <div className="flex justify-between">
                <span className="text-slate-700">System Expected Cash:</span>
                <span className="font-bold text-teal-700">
                  {formatINR(closingPrintRecord.cash_system_paise || closingPrintRecord.cashSystemPaise || 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-700">Physical Cash Counted:</span>
                <span className="font-bold text-slate-900">
                  {formatINR(closingPrintRecord.cash_physical_paise || closingPrintRecord.cashPhysicalPaise || 0)}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200 font-bold">
                <span className="text-slate-900">Closing Discrepancy:</span>
                <span
                  className={
                    (closingPrintRecord.cash_discrepancy_paise ?? closingPrintRecord.cashDiscrepancyPaise) === 0
                      ? "text-emerald-700"
                      : (closingPrintRecord.cash_discrepancy_paise ?? closingPrintRecord.cashDiscrepancyPaise) < 0
                      ? "text-amber-700"
                      : "text-sky-700"
                  }
                >
                  {(closingPrintRecord.cash_discrepancy_paise ?? closingPrintRecord.cashDiscrepancyPaise) === 0
                    ? "Balanced (₹0.00)"
                    : (closingPrintRecord.cash_discrepancy_paise ?? closingPrintRecord.cashDiscrepancyPaise) < 0
                    ? `Shortage -${formatINR(Math.abs(closingPrintRecord.cash_discrepancy_paise ?? closingPrintRecord.cashDiscrepancyPaise))}`
                    : `Excess +${formatINR(closingPrintRecord.cash_discrepancy_paise ?? closingPrintRecord.cashDiscrepancyPaise)}`}
                </span>
              </div>
              {closingPrintRecord.notes && (
                <div className="pt-1 text-[11px] text-slate-500 font-sans italic">
                  Note: {closingPrintRecord.notes}
                </div>
              )}
            </div>

            <div className="mt-8 pt-4 border-t border-slate-200 grid grid-cols-2 gap-8 text-[11px] text-slate-500 text-center font-sans">
              <div>
                <div className="border-b border-slate-300 h-8 mb-1"></div>
                <span>Cashier / Pharmacist Signature</span>
              </div>
              <div>
                <div className="border-b border-slate-300 h-8 mb-1"></div>
                <span>Store Owner / Manager Verification</span>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={() => setClosingPrintRecord(null)}
                className="px-3 py-1 text-xs rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-1.5 text-xs font-semibold rounded bg-teal-600 text-white hover:bg-teal-700 shadow-sm flex items-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Day Close Certificate</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* DRAWER / SIDE SHEET: CUSTOMER DETAIL & TRANSACTION LEDGER             */}
      {/* ==================================================================== */}
      {showCustomerDrawer && khataData?.selectedCustomer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-white dark:bg-navy-800 h-full overflow-y-auto p-5 shadow-2xl border-l border-slate-200 dark:border-navy-700 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-700">
              <div>
                <h3 className="text-base font-bold text-navy-900 dark:text-slate-100">
                  {khataData.selectedCustomer.name}
                </h3>
                <span className="text-xs font-mono text-slate-500">
                  {khataData.selectedCustomer.phone || "No phone"} · {khataData.selectedCustomer.address || "Colony Resident"}
                </span>
              </div>
              <button
                onClick={() => setShowCustomerDrawer(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer Metrics */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
                <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase">
                  Net Outstanding Due
                </span>
                <div className="mt-1 text-base font-bold font-mono text-amber-900 dark:text-amber-200">
                  {formatINR(khataData.selectedCustomer.balancePaise)}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-navy-900 border border-slate-200 dark:border-navy-700">
                <span className="text-[10px] font-semibold text-slate-500 uppercase">
                  Credit Limit
                </span>
                <div className="mt-1 text-base font-bold font-mono text-slate-800 dark:text-slate-200">
                  {khataData.selectedCustomer.creditLimitPaise > 0
                    ? formatINR(khataData.selectedCustomer.creditLimitPaise)
                    : "None"}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800">
                <span className="text-[10px] font-semibold text-teal-700 dark:text-teal-400 uppercase">
                  Unpaid Invoices
                </span>
                <div className="mt-1 text-base font-bold font-mono text-teal-900 dark:text-teal-200">
                  {khataData.selectedCustomer.unpaidBillsCount} Bills
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenPaymentModal(khataData.selectedCustomer)}
                className="flex-1 h-8 rounded-md bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-xs transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Record Payment</span>
              </button>

              {khataData.selectedCustomer.phone && khataData.selectedCustomer.balancePaise > 0 && (
                <a
                  href={`https://wa.me/91${String(khataData.selectedCustomer.phone).replace(/\D/g, "")}?text=${encodeURIComponent(
                    `Namaste ${khataData.selectedCustomer.name}, gentle reminder from pharmacy: your account balance of ${formatINR(
                      khataData.selectedCustomer.balancePaise
                    )} is due. Thank you!`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 h-8 rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5 stroke-[2]" />
                  <span>Send Reminder</span>
                </a>
              )}
            </div>

            {/* Invoices List */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-navy-900 dark:text-slate-100 uppercase tracking-wider">
                Credit Invoices History ({khataData.invoices.length})
              </h4>
              <div className="border border-slate-200 dark:border-navy-700 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 font-semibold border-b border-slate-200 dark:border-navy-700">
                    <tr>
                      <th className="p-2">Invoice #</th>
                      <th className="p-2">Date</th>
                      <th className="p-2 text-right">Total</th>
                      <th className="p-2 text-right">Paid</th>
                      <th className="p-2 text-right">Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-mono">
                    {khataData.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="p-2 text-teal-700 dark:text-teal-400 font-medium">{inv.invoiceNo}</td>
                        <td className="p-2 text-slate-500">{inv.invoiceDate}</td>
                        <td className="p-2 text-right">{formatINR(inv.totalPaise)}</td>
                        <td className="p-2 text-right text-emerald-600">{formatINR(inv.paidPaise)}</td>
                        <td className="p-2 text-right font-bold text-amber-700 dark:text-amber-400">
                          {formatINR(inv.duePaise)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Ledger Transactions */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-navy-900 dark:text-slate-100 uppercase tracking-wider">
                Full Running Ledger Statement
              </h4>
              <div className="border border-slate-200 dark:border-navy-700 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 font-semibold border-b border-slate-200 dark:border-navy-700">
                    <tr>
                      <th className="p-2">Date</th>
                      <th className="p-2">Particulars</th>
                      <th className="p-2 text-right">Debit (Dr)</th>
                      <th className="p-2 text-right">Credit (Cr)</th>
                      <th className="p-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-mono">
                    {khataData.ledgerEntries.map((le) => (
                      <tr key={le.id}>
                        <td className="p-2 text-slate-500">{le.date}</td>
                        <td className="p-2 font-sans font-medium text-navy-900 dark:text-slate-100">
                          {le.docId}
                          <span className="block text-[10px] text-slate-400">{le.narration}</span>
                        </td>
                        <td className="p-2 text-right text-amber-700">
                          {le.debitPaise > 0 ? formatINR(le.debitPaise) : "—"}
                        </td>
                        <td className="p-2 text-right text-emerald-600">
                          {le.creditPaise > 0 ? formatINR(le.creditPaise) : "—"}
                        </td>
                        <td className="p-2 text-right font-bold text-navy-900 dark:text-slate-100">
                          {formatINR(le.runningBalancePaise)} {le.nature.toUpperCase()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Register New Customer / Patient Modal */}
      <AddCustomerModal
        isOpen={showAddCustomerModal}
        onClose={() => setShowAddCustomerModal(false)}
        onCustomerCreated={(newCust) => {
          fetchKhata();
          fetchAccounts();
          setActiveKhataCustomerId(newCust.id);
        }}
      />
    </div>
  );
}
