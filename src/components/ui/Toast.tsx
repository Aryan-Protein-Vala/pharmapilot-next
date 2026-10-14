"use client";

import React, { createContext, useContext, useState, useCallback, useId } from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: (options: Omit<ToastItem, "id">) => string;
  dismissToast: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, variant = "info", duration = 4000 }: Omit<ToastItem, "id">) => {
      const id = "toast-" + Math.random().toString(36).substring(2, 9);
      const newToast: ToastItem = { id, title, description, variant, duration };

      setToasts((prev) => [...prev, newToast]);

      if (duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, duration);
      }
      return id;
    },
    [dismissToast]
  );

  const success = useCallback((title: string, description?: string) => toast({ title, description, variant: "success" }), [toast]);
  const error = useCallback((title: string, description?: string) => toast({ title, description, variant: "error" }), [toast]);
  const warning = useCallback((title: string, description?: string) => toast({ title, description, variant: "warning" }), [toast]);
  const info = useCallback((title: string, description?: string) => toast({ title, description, variant: "info" }), [toast]);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismissToast, success, error, warning, info }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastContainer() {
  const context = useContext(ToastContext);
  if (!context || context.toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="assertive" role="region">
      {context.toasts.map((item) => {
        let Icon = Info;
        let borderClass = "border-navy-700 bg-white dark:bg-navy-800 text-navy-900 dark:text-slate-100";
        let iconClass = "text-navy-700 dark:text-slate-300";

        if (item.variant === "success") {
          Icon = CheckCircle2;
          borderClass = "border-l-4 border-l-teal-600 bg-white dark:bg-navy-900 border-slate-200 dark:border-navy-700";
          iconClass = "text-teal-600 dark:text-teal-400";
        } else if (item.variant === "error") {
          Icon = AlertCircle;
          borderClass = "border-l-4 border-l-red-600 bg-white dark:bg-navy-900 border-slate-200 dark:border-navy-700";
          iconClass = "text-red-600 dark:text-red-400";
        } else if (item.variant === "warning") {
          Icon = AlertTriangle;
          borderClass = "border-l-4 border-l-amber-500 bg-white dark:bg-navy-900 border-slate-200 dark:border-navy-700";
          iconClass = "text-amber-600 dark:text-amber-400";
        } else {
          Icon = Info;
          borderClass = "border-l-4 border-l-blue-600 bg-white dark:bg-navy-900 border-slate-200 dark:border-navy-700";
          iconClass = "text-blue-600 dark:text-blue-400";
        }

        return (
          <div
            key={item.id}
            className={cn(
              "flex items-start gap-3 p-3.5 rounded-md shadow-lg border text-sm max-w-sm w-full transition-all duration-200 animate-in fade-in slide-in-from-bottom-2",
              borderClass
            )}
            role="alert"
          >
            <Icon className={cn("w-4 h-4 mt-0.5 shrink-0 stroke-[2.25]", iconClass)} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-xs tracking-tight text-navy-900 dark:text-slate-100">{item.title}</p>
              {item.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">{item.description}</p>
              )}
            </div>
            <button
              onClick={() => context.dismissToast(item.id)}
              className="text-slate-400 hover:text-navy-900 dark:hover:text-white p-0.5 rounded transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5 stroke-[2]" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
