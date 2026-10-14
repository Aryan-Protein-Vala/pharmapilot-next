"use client";

import React, { useState, useEffect } from "react";
import {
  Sun,
  Moon,
  Clock,
  ShieldCheck,
  Building2,
  Database,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TopbarProps {
  storeName?: string;
  drugLicenseNo?: string;
  gstin?: string;
}

export function Topbar({
  storeName = "Apex Life Chemist & Druggist",
  drugLicenseNo = "DL-20B/21B-48921",
  gstin = "07AAAAA0000A1Z5",
}: TopbarProps) {
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");
  const [isDark, setIsDark] = useState<boolean>(false);

  // Initialize clock and theme once mounted on client
  useEffect(() => {
    setMounted(true);

    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-IN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
      setCurrentDate(
        now.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      );
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);

    // Initial theme check
    const savedTheme = localStorage.getItem("pharmapilot_theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDarkInitial = savedTheme === "dark" || (!savedTheme && prefersDark);

    if (isDarkInitial) {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
      setIsDark(true);
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.setAttribute("data-theme", "light");
      setIsDark(false);
    }

    return () => clearInterval(interval);
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);

    if (nextDark) {
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("pharmapilot_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("pharmapilot_theme", "light");
    }
  };

  return (
    <header className="app-topbar border-b border-slate-200 dark:border-navy-800 bg-white dark:bg-navy-900 px-4 h-14 flex items-center justify-between shrink-0 select-none">
      {/* Store Identity & Branch */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-navy-900 dark:text-slate-100 tracking-tight leading-none">
              {storeName}
            </h1>
            <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-navy-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-navy-700">
              Retail Counter 01
            </span>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            PharmaPilot Retail ERP · Indian Schedule Compliance
          </span>
        </div>
      </div>

      {/* Middle Compliance Badges (Drug License & GSTIN) */}
      <div className="hidden md:flex items-center gap-2.5">
        {/* Drug License Form 20B/21B Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/60 text-teal-800 dark:text-teal-300 text-xs font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 stroke-[2.25]" />
          <span className="font-semibold text-[11px]">Form 20B/21B:</span>
          <span className="font-mono text-[11px] tabular-nums">{drugLicenseNo}</span>
        </div>

        {/* GSTIN Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-50 dark:bg-navy-800/70 border border-slate-200 dark:border-navy-700 text-slate-700 dark:text-slate-300 text-xs font-medium">
          <Building2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 stroke-[2]" />
          <span className="font-semibold text-[11px]">GSTIN:</span>
          <span className="font-mono text-[11px] tabular-nums tracking-wide">{gstin}</span>
        </div>
      </div>

      {/* Right Side: Local DB Status, Live System Clock, Dark/Light Mode Toggle */}
      <div className="flex items-center gap-3">
        {/* SQLite / Local DB Live Status Pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs font-medium">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <Database className="w-3 h-3 text-emerald-600 dark:text-emerald-400 stroke-[2]" />
          <span className="text-[11px] font-mono">WAL SQLite Active</span>
        </div>

        {/* Live System Clock */}
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-50 dark:bg-navy-800 border border-slate-200 dark:border-navy-700 text-navy-900 dark:text-slate-200 text-xs font-medium">
          <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 stroke-[2]" />
          <div className="flex items-baseline gap-1.5 font-mono tabular-nums text-[11px]">
            <span>{mounted ? currentTime : "--:--:--"}</span>
            <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">·</span>
            <span className="text-slate-500 dark:text-slate-400 hidden sm:inline">{mounted ? currentDate : "---"}</span>
          </div>
        </div>

        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800 text-slate-600 dark:text-slate-300 hover:text-navy-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-navy-700 transition-colors"
          title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
          aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {mounted && isDark ? (
            <Sun className="w-4 h-4 stroke-[2] text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 stroke-[2] text-slate-600 dark:text-slate-300" />
          )}
        </button>
      </div>
    </header>
  );
}
