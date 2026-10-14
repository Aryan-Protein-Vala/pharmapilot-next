"use client";

import React, { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ToastProvider, ToastContainer } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const savedPin = localStorage.getItem("pharmapilot_rail_pinned");
    if (savedPin === "true") {
      setIsPinned(true);
    }
  }, []);

  const handleTogglePin = () => {
    setIsPinned((prev) => {
      const next = !prev;
      localStorage.setItem("pharmapilot_rail_pinned", String(next));
      return next;
    });
  };

  return (
    <ToastProvider>
      <div
        className={cn(
          "app-shell min-h-screen w-full bg-slate-50 dark:bg-navy-900 transition-[padding-left] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          mounted && isPinned ? "rail-pinned !pl-[260px]" : "!pl-[68px]"
        )}
      >
        {/* Left-Side Navigation Rail */}
        <Sidebar
          isPinned={isPinned}
          onTogglePin={handleTogglePin}
          isHovered={isHovered}
          setIsHovered={setIsHovered}
        />

        {/* Workspace Canvas (Topbar + Main Viewport) */}
        <div className="page-workspace flex flex-col min-h-screen min-w-0">
          <Topbar
            onToggleSidebar={handleTogglePin}
            isSidebarExpanded={isPinned || isHovered}
          />
          <main className="flex-1 p-5 md:p-6 overflow-y-auto">
            {children}
          </main>
        </div>

        {/* Global Toast Container */}
        <ToastContainer />
      </div>
    </ToastProvider>
  );
}
