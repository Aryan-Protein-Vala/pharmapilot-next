"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  Package,
  Truck,
  FileCheck,
  FileSpreadsheet,
  BookOpen,
  UploadCloud,
  Pin,
  PinOff,
  Activity,
  ChevronLeft,
  ChevronRight,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  badgeVariant?: "default" | "alert" | "teal";
}

const NAV_ITEMS: NavItem[] = [
  {
    name: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    name: "POS Billing",
    href: "/pos",
    icon: Receipt,
  },
  {
    name: "Inventory",
    href: "/inventory",
    icon: Package,
    badge: 3,
    badgeVariant: "alert",
  },
  {
    name: "Purchases",
    href: "/purchases",
    icon: Truck,
  },
  {
    name: "Compliance Register",
    href: "/compliance",
    icon: BookOpen,
  },
  {
    name: "GST Reports",
    href: "/gst-reports",
    icon: FileCheck,
  },
  {
    name: "Accounts & Ledger",
    href: "/accounts",
    icon: FileSpreadsheet,
  },
  {
    name: "Marg Migration",
    href: "/import",
    icon: UploadCloud,
    badge: "Marg",
    badgeVariant: "teal",
  },
  {
    name: "Store Settings",
    href: "/settings",
    icon: Settings,
  },
];

interface SidebarProps {
  isPinned: boolean;
  onTogglePin: () => void;
  isHovered: boolean;
  setIsHovered: (hovered: boolean) => void;
}

export function Sidebar({ isPinned, onTogglePin, isHovered, setIsHovered }: SidebarProps) {
  const pathname = usePathname();
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isExpanded = isPinned || isHovered;

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      setActiveTooltip(null);
    }, 120);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-expanded={isExpanded ? "true" : "false"}
      style={{
        width: isExpanded ? "260px" : "68px",
        minWidth: isExpanded ? "260px" : "68px",
        maxWidth: isExpanded ? "260px" : "68px",
      }}
      className={cn(
        "left-nav-rail fixed top-0 left-0 bottom-0 z-50 flex flex-col bg-white dark:bg-navy-900 border-r border-slate-200 dark:border-navy-800 transition-[width,min-width,max-width,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] select-none",
        isExpanded ? "expanded shadow-2xl" : "collapsed shadow-none",
        isPinned && "pinned"
      )}
      aria-label="Sidebar Navigation"
    >
      {/* Brand Header */}
      <div className="h-14 flex items-center justify-between px-3.5 border-b border-slate-100 dark:border-navy-800 shrink-0 overflow-hidden">
        <Link href="/" className="flex items-center gap-3 overflow-hidden min-w-0">
          <div className="w-9 h-9 min-w-[36px] rounded-lg bg-teal-600 flex items-center justify-center text-white font-bold shadow-sm shrink-0">
            <Activity className="w-5 h-5 stroke-[2.25]" />
          </div>
          {isExpanded && (
            <div className="flex flex-col whitespace-nowrap overflow-hidden min-w-0 animate-in fade-in duration-150">
              <span className="font-semibold text-sm tracking-tight text-navy-900 dark:text-slate-100 leading-none truncate">
                PharmaPilot
              </span>
              <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 tracking-wider uppercase mt-1 truncate">
                Enterprise ERP
              </span>
            </div>
          )}
        </Link>

        {isExpanded && (
          <button
            onClick={onTogglePin}
            className={cn(
              "p-1.5 rounded-md transition-colors text-slate-400 hover:text-navy-900 dark:hover:text-slate-100 shrink-0",
              isPinned
                ? "bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
                : "hover:bg-slate-100 dark:hover:bg-navy-800"
            )}
            title={isPinned ? "Unpin navigation rail" : "Pin navigation rail"}
            aria-label={isPinned ? "Unpin navigation rail" : "Pin navigation rail"}
          >
            {isPinned ? (
              <Pin className="w-4 h-4 stroke-[2] fill-teal-600 text-teal-600 dark:fill-teal-400 dark:text-teal-400" />
            ) : (
              <PinOff className="w-4 h-4 stroke-[2]" />
            )}
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden p-2 flex flex-col gap-1 custom-scrollbar">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
          const IconComponent = item.icon;

          return (
            <div
              key={item.href}
              className="relative group w-full"
              onMouseEnter={() => !isExpanded && setActiveTooltip(item.name)}
              onMouseLeave={() => setActiveTooltip(null)}
            >
              <Link
                href={item.href}
                className={cn(
                  "relative flex items-center h-10 px-3 rounded-lg text-xs font-medium transition-colors gap-3 overflow-hidden w-full",
                  isActive
                    ? "bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-semibold"
                    : "text-slate-600 dark:text-slate-400 hover:text-navy-900 dark:hover:text-slate-100 hover:bg-slate-100/80 dark:hover:bg-navy-800/60"
                )}
              >
                {/* Active indicator bar */}
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-teal-600 dark:bg-teal-400 rounded-r" />
                )}

                {/* Vector Line Icon */}
                <span
                  className={cn(
                    "w-5 h-5 min-w-[20px] flex items-center justify-center transition-colors shrink-0",
                    isActive ? "text-teal-600 dark:text-teal-400" : "text-slate-500 dark:text-slate-400 group-hover:text-navy-900 dark:group-hover:text-slate-200"
                  )}
                >
                  <IconComponent className="w-5 h-5 stroke-[1.85]" />
                </span>

                {/* Nav Label */}
                {isExpanded && (
                  <span className="whitespace-nowrap transition-opacity duration-150 flex-1 truncate text-xs font-medium">
                    {item.name}
                  </span>
                )}

                {/* Counter / Status Badge */}
                {item.badge !== undefined && isExpanded && (
                  <span
                    className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums shrink-0 ml-auto",
                      item.badgeVariant === "alert"
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300"
                        : item.badgeVariant === "teal"
                        ? "bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300"
                        : "bg-slate-100 text-slate-700 dark:bg-navy-800 dark:text-slate-300"
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>

              {/* Floating Tooltip when collapsed */}
              {!isExpanded && activeTooltip === item.name && (
                <div
                  className="absolute left-[64px] top-1/2 -translate-y-1/2 z-50 px-2.5 py-1 text-xs font-medium rounded-md shadow-md bg-navy-900 text-white dark:bg-navy-800 dark:text-slate-100 dark:border dark:border-navy-700 whitespace-nowrap pointer-events-none animate-in fade-in zoom-in-95 duration-100"
                  role="tooltip"
                >
                  {item.name}
                  {item.badge !== undefined && (
                    <span className="ml-1.5 opacity-75 font-mono text-[10px]">
                      ({item.badge})
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Rail Footer with Quick Expand/Collapse Button */}
      <div className="p-2 border-t border-slate-100 dark:border-navy-800 shrink-0 flex flex-col gap-1.5 overflow-hidden">
        <button
          onClick={onTogglePin}
          className={cn(
            "flex items-center h-8 px-2.5 rounded-lg text-xs font-medium transition-colors gap-3 w-full",
            isPinned
              ? "bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300"
              : "text-slate-500 hover:bg-slate-100 dark:hover:bg-navy-800 hover:text-navy-900 dark:hover:text-slate-200"
          )}
          title={isPinned ? "Click to unpin sidebar" : "Click to pin/lock sidebar open"}
        >
          <span className="w-5 h-5 min-w-[20px] flex items-center justify-center shrink-0 text-slate-400">
            {isExpanded ? (
              <ChevronLeft className="w-4 h-4 stroke-[2]" />
            ) : (
              <ChevronRight className="w-4 h-4 stroke-[2]" />
            )}
          </span>
          {isExpanded && (
            <span className="truncate text-[11px] font-medium">
              {isPinned ? "Collapse Sidebar" : "Pin Sidebar Open"}
            </span>
          )}
        </button>

        <div className="flex items-center gap-2.5 px-1 py-1">
          <div className="w-7 h-7 min-w-[28px] rounded-full bg-slate-100 dark:bg-navy-800 border border-slate-200 dark:border-navy-700 flex items-center justify-center text-[11px] font-semibold text-navy-800 dark:text-slate-200 shrink-0">
            RP
          </div>
          {isExpanded && (
            <div className="flex flex-col overflow-hidden whitespace-nowrap min-w-0">
              <span className="text-xs font-medium text-navy-900 dark:text-slate-200 truncate leading-none">
                Reg. Pharmacist
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                Lic: 20B/21B Active
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
