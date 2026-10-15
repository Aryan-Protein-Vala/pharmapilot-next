"use client";

import React, { useState, useEffect } from "react";
import {
  Settings,
  Building2,
  ShieldCheck,
  FileText,
  Phone,
  Mail,
  MapPin,
  User,
  CheckCircle2,
  Save,
  RefreshCw,
  QrCode,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export default function SettingsPage() {
  const { success, error, warning } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form State
  const [storeName, setStoreName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [stateCode, setStateCode] = useState("29");
  const [gstin, setGstin] = useState("");
  const [dl1, setDl1] = useState("");
  const [dl2, setDl2] = useState("");
  const [pharmacistName, setPharmacistName] = useState("");
  const [pharmacistRegNo, setPharmacistRegNo] = useState("");
  const [adminName, setAdminName] = useState("");

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/settings");
      if (res.ok) {
        const data = await res.json();
        const p = data.profile || {};
        const u = data.user || {};
        setStoreName(p.name || "");
        setPhone(p.phone || "");
        setEmail(p.email || "");
        setAddress(p.address || "");
        setStateCode(p.state_code || "29");
        setGstin(p.gstin || "");
        setDl1(p.drug_license_no_1 || "");
        setDl2(p.drug_license_no_2 || "");
        setPharmacistName(p.pharmacist_name || "");
        setPharmacistRegNo(p.pharmacist_reg_no || "");
        setAdminName(u.name || "Admin Pharmacist");
      }
    } catch (err: any) {
      error("Error", "Failed to load store settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim()) {
      warning("Required", "Pharmacy name cannot be empty");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: storeName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          stateCode: stateCode.trim(),
          gstin: gstin.trim().toUpperCase(),
          drugLicenseNo1: dl1.trim().toUpperCase(),
          drugLicenseNo2: dl2.trim().toUpperCase(),
          pharmacistName: pharmacistName.trim(),
          pharmacistRegNo: pharmacistRegNo.trim().toUpperCase(),
          adminName: adminName.trim(),
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to save settings");
      }

      success("Settings Saved", "Pharmacy profile and license numbers updated successfully.");
      // Trigger a local storage / event update so Topbar updates immediately
      window.dispatchEvent(new Event("pharmapilot_settings_updated"));
    } catch (err: any) {
      error("Save Error", err.message || "Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="w-6 h-6 animate-spin text-teal-600" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 select-none">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              Pharmacy & Store Settings
            </h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              CDSCO Compliant
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Configure your pharmacy name, Form 20B/21B drug license numbers, GSTIN, and pharmacist credentials. All changes reflect instantly on bills and reports.
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
        >
          {saving ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          <span>Save Changes</span>
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 1: Pharmacy Identity */}
        <div className="rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-navy-700">
            <Building2 className="w-4 h-4 text-teal-600" />
            <h2 className="text-sm font-bold text-navy-900 dark:text-slate-100">
              Pharmacy Store Identity
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1 md:col-span-2">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Pharmacy / Medical Hall Name *
              </label>
              <input
                type="text"
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                placeholder="e.g. Apex Life Chemist & Druggist"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-teal-500"
              />
              <span className="text-[10px] text-slate-400">
                This exact name will be printed on top of thermal receipts and A4 tax invoices.
              </span>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Contact Phone / Counter Mobile *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98450 11223"
                  className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-teal-500 font-mono"
                />
                <Phone className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Official Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="pharmacy@example.com"
                  className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-teal-500"
                />
                <Mail className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
              </div>
            </div>

            <div className="space-y-1 md:col-span-2">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Store Physical Address *
              </label>
              <div className="relative">
                <textarea
                  rows={2}
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Shop No, Complex, Street Name, Colony, City, Pincode"
                  className="w-full p-2.5 pl-8 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-teal-500"
                />
                <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Statutory Drug Licenses & GSTIN */}
        <div className="rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-navy-700">
            <ShieldCheck className="w-4 h-4 text-teal-600" />
            <h2 className="text-sm font-bold text-navy-900 dark:text-slate-100">
              Statutory Drug Licenses & GSTIN
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Drug License No. (Form 20B - Allopathic) *
              </label>
              <input
                type="text"
                required
                value={dl1}
                onChange={(e) => setDl1(e.target.value)}
                placeholder="KA-B2-192842"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-mono font-medium focus:outline-none focus:border-teal-500 uppercase"
              />
              <span className="text-[10px] text-slate-400">Retail allopathic license</span>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Drug License No. (Form 21B - Specified Drugs)
              </label>
              <input
                type="text"
                value={dl2}
                onChange={(e) => setDl2(e.target.value)}
                placeholder="KA-B3-192843"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-mono font-medium focus:outline-none focus:border-teal-500 uppercase"
              />
              <span className="text-[10px] text-slate-400">Schedule C & C1 drugs</span>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                GSTIN (15-Digit GST Number) *
              </label>
              <input
                type="text"
                required
                maxLength={15}
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                placeholder="29AABCU9603R1ZM"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-mono font-medium focus:outline-none focus:border-teal-500 uppercase"
              />
              <span className="text-[10px] text-slate-400">State Code: {gstin.slice(0, 2) || stateCode}</span>
            </div>
          </div>
        </div>

        {/* Section 3: Registered Pharmacist & Admin Details */}
        <div className="rounded-lg border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-navy-700">
            <User className="w-4 h-4 text-teal-600" />
            <h2 className="text-sm font-bold text-navy-900 dark:text-slate-100">
              Pharmacist & Counter Personnel
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Registered Pharmacist Name *
              </label>
              <input
                type="text"
                required
                value={pharmacistName}
                onChange={(e) => setPharmacistName(e.target.value)}
                placeholder="Vikas Sharma"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-teal-500"
              />
              <span className="text-[10px] text-slate-400">Name on Pharmacy Council Register</span>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Pharmacist Reg. Certificate No. *
              </label>
              <input
                type="text"
                required
                value={pharmacistRegNo}
                onChange={(e) => setPharmacistRegNo(e.target.value)}
                placeholder="KSPC-49201-A"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-mono font-medium focus:outline-none focus:border-teal-500 uppercase"
              />
              <span className="text-[10px] text-slate-400">State Pharmacy Council Reg No.</span>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Current Admin / Chemist Owner Name
              </label>
              <input
                type="text"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
                placeholder="Aryan Sharma"
                className="w-full h-9 px-3 rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-900 text-slate-900 dark:text-slate-100 font-medium focus:outline-none focus:border-teal-500"
              />
              <span className="text-[10px] text-slate-400">Primary billing operator name</span>
            </div>
          </div>
        </div>

        {/* Section 4: Save Action Footer */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={loadSettings}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Reset to Stored Values</span>
          </button>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
          >
            {saving ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save Pharmacy Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
}
