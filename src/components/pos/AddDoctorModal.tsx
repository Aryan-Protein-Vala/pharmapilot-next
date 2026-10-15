"use client";

import React, { useState } from "react";
import { X, Stethoscope, Building, Phone, Mail, Check } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

interface AddDoctorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDoctorCreated: (doctor: any) => void;
}

export function AddDoctorModal({
  isOpen,
  onClose,
  onDoctorCreated,
}: AddDoctorModalProps) {
  const { success, error } = useToast();
  const [name, setName] = useState("");
  const [regNo, setRegNo] = useState("");
  const [qualification, setQualification] = useState("MBBS, MD");
  const [clinicName, setClinicName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      error("Validation Error", "Doctor name is required.");
      return;
    }

    if (!regNo.trim()) {
      error("Validation Error", "Medical Council Registration No. is required for Schedule H/H1 compliance.");
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/doctors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.startsWith("Dr.") ? name.trim() : `Dr. ${name.trim()}`,
          regNo: regNo.trim().toUpperCase(),
          qualification: qualification.trim() || undefined,
          clinicName: clinicName.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to register doctor");
      }

      success("Doctor Registered", `${data.doctor.name} (${data.doctor.reg_no}) registered successfully.`);

      onDoctorCreated(data.doctor);
      setName("");
      setRegNo("");
      setQualification("MBBS, MD");
      setClinicName("");
      setPhone("");
      onClose();
    } catch (err: any) {
      error("Registration Failed", err.message || "Could not register doctor.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-md rounded-xl bg-white dark:bg-navy-900 border border-slate-200 dark:border-navy-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-navy-800 bg-slate-50 dark:bg-navy-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 flex items-center justify-center text-teal-600 dark:text-teal-400">
              <Stethoscope className="w-4 h-4 stroke-[2.25]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-navy-900 dark:text-slate-100">
                Register Prescribing Doctor
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Prescription auditing & Schedule H/H1/X compliance records.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-navy-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-navy-900 dark:text-slate-200 mb-1">
              Doctor Full Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Dr. Rajesh Sharma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 px-3 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-navy-900 dark:text-slate-200 mb-1">
                Medical Reg No <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. MCI-29482"
                value={regNo}
                onChange={(e) => setRegNo(e.target.value)}
                className="w-full h-9 px-3 text-xs font-mono uppercase rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-navy-900 dark:text-slate-200 mb-1">
                Qualification
              </label>
              <input
                type="text"
                placeholder="MBBS, MD (Med)"
                value={qualification}
                onChange={(e) => setQualification(e.target.value)}
                className="w-full h-9 px-3 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-navy-900 dark:text-slate-200 mb-1 flex items-center gap-1">
                <Building className="w-3 h-3 text-slate-400" />
                <span>Hospital / Clinic</span>
              </label>
              <input
                type="text"
                placeholder="City Care Clinic"
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                className="w-full h-9 px-3 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-navy-900 dark:text-slate-200 mb-1 flex items-center gap-1">
                <Phone className="w-3 h-3 text-slate-400" />
                <span>Contact Phone</span>
              </label>
              <input
                type="tel"
                placeholder="10-digit mobile"
                maxLength={10}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                className="w-full h-9 px-3 text-xs font-mono rounded-md border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-navy-800">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-navy-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{submitting ? "Registering..." : "Register & Select"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
