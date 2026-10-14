// src/lib/compliance.ts — Schedule H / H1 / X / NDPS Interceptor & CDSCO Register Builder

export type DrugSchedule = 'none' | 'OTC' | 'H' | 'H1' | 'X' | 'NDPS';

export const RESTRICTED_SCHEDULES: readonly DrugSchedule[] = ['H', 'H1', 'X', 'NDPS'] as const;

/**
 * Checks whether a drug schedule is restricted under the Drugs and Cosmetics Rules.
 * Requires prescription, patient identity, and doctor registration details.
 */
export function isRestrictedSchedule(schedule?: string | null): boolean {
  if (!schedule) return false;
  const upper = schedule.trim().toUpperCase();
  return RESTRICTED_SCHEDULES.includes(upper as DrugSchedule);
}

/**
 * Checks whether schedule requires mandatory CDSCO Schedule H1 / X / NDPS register logging.
 */
export function isScheduleH1OrXOrNDPS(schedule?: string | null): boolean {
  if (!schedule) return false;
  const upper = schedule.trim().toUpperCase();
  return upper === 'H1' || upper === 'X' || upper === 'NDPS';
}

export interface ComplianceItemLine {
  id?: string;
  itemId?: string;
  itemName: string;
  schedule: DrugSchedule | string;
  batchNo?: string;
  qty?: number;
}

export interface ComplianceDoctorInfo {
  id?: string;
  name?: string;
  regNo?: string;
  phone?: string;
  clinic?: string;
}

export interface CompliancePatientInfo {
  name?: string;
  address?: string;
  phone?: string;
}

export interface ValidateComplianceInput {
  lines: ComplianceItemLine[];
  // Supports either nested or flat parameter conventions
  patient?: CompliancePatientInfo | null;
  doctor?: ComplianceDoctorInfo | null;
  patientName?: string | null;
  patientAddress?: string | null;
  doctorName?: string | null;
  doctorRegNo?: string | null;
}

export interface ComplianceViolation {
  field: 'patientName' | 'patientAddress' | 'doctorName' | 'doctorRegNo';
  message: string;
  items: string[];
  schedules: string[];
}

export interface ComplianceValidationResult {
  valid: boolean;
  hasRestrictedItems: boolean;
  restrictedSchedulesFound: string[];
  violations: ComplianceViolation[];
  errors: string[];
}

/**
 * Validates mandatory prescription compliance for Schedule H, H1, X, and NDPS items.
 * Validates that Patient Name, Patient Address, Doctor Name, and Prescribing Doctor
 * Registration Number are strictly non-empty.
 */
export function validatePrescriptionCompliance(
  input: ValidateComplianceInput
): ComplianceValidationResult {
  const restrictedLines: ComplianceItemLine[] = [];
  const restrictedSchedulesSet = new Set<string>();

  for (const line of input.lines || []) {
    if (isRestrictedSchedule(line.schedule)) {
      restrictedLines.push(line);
      restrictedSchedulesSet.add(line.schedule.trim().toUpperCase());
    }
  }

  const hasRestrictedItems = restrictedLines.length > 0;
  const restrictedSchedulesFound = Array.from(restrictedSchedulesSet);

  if (!hasRestrictedItems) {
    return {
      valid: true,
      hasRestrictedItems: false,
      restrictedSchedulesFound: [],
      violations: [],
      errors: [],
    };
  }

  // Resolve patient fields (flat or nested)
  const patientName = (input.patient?.name ?? input.patientName ?? '').trim();
  const patientAddress = (input.patient?.address ?? input.patientAddress ?? '').trim();

  // Resolve doctor fields (flat or nested)
  const doctorName = (input.doctor?.name ?? input.doctorName ?? '').trim();
  const doctorRegNo = (input.doctor?.regNo ?? input.doctorRegNo ?? '').trim();

  const itemNames = restrictedLines.map((l) => l.itemName).join(', ');
  const violations: ComplianceViolation[] = [];
  const errors: string[] = [];

  if (!patientName) {
    const msg = `Patient Name is mandatory for Schedule ${restrictedSchedulesFound.join('/')} items (${itemNames})`;
    violations.push({
      field: 'patientName',
      message: msg,
      items: restrictedLines.map((l) => l.itemName),
      schedules: restrictedSchedulesFound,
    });
    errors.push(msg);
  }

  if (!patientAddress) {
    const msg = `Patient Address is mandatory for Schedule ${restrictedSchedulesFound.join('/')} items (${itemNames})`;
    violations.push({
      field: 'patientAddress',
      message: msg,
      items: restrictedLines.map((l) => l.itemName),
      schedules: restrictedSchedulesFound,
    });
    errors.push(msg);
  }

  if (!doctorName) {
    const msg = `Prescribing Doctor Name is mandatory for Schedule ${restrictedSchedulesFound.join('/')} items (${itemNames})`;
    violations.push({
      field: 'doctorName',
      message: msg,
      items: restrictedLines.map((l) => l.itemName),
      schedules: restrictedSchedulesFound,
    });
    errors.push(msg);
  }

  if (!doctorRegNo) {
    const msg = `Prescribing Doctor Registration Number (MCI / State Council) is mandatory for Schedule ${restrictedSchedulesFound.join('/')} items (${itemNames})`;
    violations.push({
      field: 'doctorRegNo',
      message: msg,
      items: restrictedLines.map((l) => l.itemName),
      schedules: restrictedSchedulesFound,
    });
    errors.push(msg);
  }

  return {
    valid: violations.length === 0,
    hasRestrictedItems: true,
    restrictedSchedulesFound,
    violations,
    errors,
  };
}

export const validateCompliance = validatePrescriptionCompliance;

/**
 * Asserts that the sale satisfies all Schedule compliance rules, throwing an Error if invalid.
 */
export function assertCompliance(input: ValidateComplianceInput): void {
  const res = validatePrescriptionCompliance(input);
  if (!res.valid) {
    throw new Error(`Prescription Compliance Violation: ${res.errors.join('; ')}`);
  }
}

export interface ScheduleRegisterEntry {
  id: string;
  saleId: string;
  saleItemId: string;
  date: string;
  patientName: string;
  patientAddress: string;
  doctorName: string;
  doctorRegNo: string;
  itemName: string;
  batchNo: string;
  qty: number;
  schedule: string;
}

/**
 * Builds schedule_register database records for all H, H1, X, and NDPS items on a sale.
 */
export function buildScheduleRegisterEntries(params: {
  saleId: string;
  date: string;
  patient: { name: string; address: string };
  doctor: { name: string; regNo: string };
  lines: Array<{
    saleItemId: string;
    itemName: string;
    schedule: string;
    batchNo: string;
    qty: number;
  }>;
}): ScheduleRegisterEntry[] {
  const entries: ScheduleRegisterEntry[] = [];
  for (const line of params.lines) {
    if (isRestrictedSchedule(line.schedule)) {
      entries.push({
        id: `reg_${params.saleId}_${line.saleItemId}`,
        saleId: params.saleId,
        saleItemId: line.saleItemId,
        date: params.date,
        patientName: params.patient.name.trim(),
        patientAddress: params.patient.address.trim(),
        doctorName: params.doctor.name.trim(),
        doctorRegNo: params.doctor.regNo.trim().toUpperCase(),
        itemName: line.itemName,
        batchNo: line.batchNo,
        qty: line.qty,
        schedule: line.schedule.trim().toUpperCase(),
      });
    }
  }
  return entries;
}
