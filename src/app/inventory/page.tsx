"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Package,
  AlertTriangle,
  Clock,
  Layers,
  Search,
  Filter,
  Plus,
  ArrowUpDown,
  History,
  Trash2,
  X,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Edit2,
  BookOpen,
  Share2,
  Copy,
  Send,
  Building2,
  ExternalLink,
  AlertCircle,
  Check,
  PackagePlus,
  SlidersHorizontal,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { formatINR, paiseToRupeesStr, rupeesToPaise } from "@/lib/money";
import { formatSmartStock } from "@/lib/units";

interface BatchInfo {
  batchId: string;
  batchNo: string;
  expiryDate: string;
  daysLeft: number;
  mrpPaise: number;
  ptrPaise: number;
  stockBase: number;
}

interface StockItem {
  id: string;
  name: string;
  genericName: string;
  manufacturer: string;
  category?: string;
  drugForm?: string;
  hsnCode?: string;
  gstRateBp?: number;
  rackLocation: string;
  schedule: string;
  baseUnit: string;
  saleUnit: string;
  packSize: number;
  reorderLevel: number;
  reorderQty: number;
  barcode: string;
  nearestExpiry: string;
  currentStockBase: number;
  costValuationPaise: number;
  mrpValuationPaise: number;
  batches: BatchInfo[];
}

interface Movement {
  id: string;
  created_at: string;
  qty_base_signed: number;
  movement_type: string;
  ref_doc_id: string;
  item_name: string;
  batch_no: string;
  base_unit: string;
}

interface ShortbookItem {
  id: string;
  item_id: string | null;
  custom_item_name: string;
  distributor_id: string | null;
  requested_qty: number;
  priority: "low" | "normal" | "urgent";
  notes: string;
  status: "pending" | "ordered" | "received" | "cancelled";
  created_at: string;
  updated_at: string;
  item_name?: string;
  generic_name?: string;
  base_unit?: string;
  rack_location?: string;
  reorder_level?: number;
  reorder_qty?: number;
  manufacturer_name?: string;
  distributor_name?: string;
  distributor_phone?: string;
  sale_unit?: string;
  pack_size?: number;
  current_stock_base?: number;
}

interface AutoLowStockItem {
  itemId: string;
  itemName: string;
  genericName: string;
  manufacturer: string;
  rackLocation: string;
  currentStock: number;
  reorderLevel: number;
  suggestedQty: number;
  baseUnit: string;
  saleUnit: string;
  packSize: number;
  isAlreadyInShortbook: boolean;
  priority: "urgent" | "normal";
}

interface Distributor {
  id: string;
  name: string;
  phone: string;
  gstin: string;
}

export default function InventoryPage() {
  const { success, warning, error, info } = useToast();

  const [stockGrid, setStockGrid] = useState<StockItem[]>([]);
  const [grandCostPaise, setGrandCostPaise] = useState(0);
  const [grandMrpPaise, setGrandMrpPaise] = useState(0);
  const [recentMovements, setRecentMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  // Shortbook data
  const [shortbookItems, setShortbookItems] = useState<ShortbookItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<AutoLowStockItem[]>([]);
  const [distributors, setDistributors] = useState<Distributor[]>([]);

  // Navigation & Filters
  const [activeTab, setActiveTab] = useState<"stock" | "expiry" | "shortbook" | "ledger">("stock");
  const [expiryWindow, setExpiryWindow] = useState<"all" | "30" | "60" | "90" | "expired">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());

  // Shortbook Sub-filters
  const [shortbookFilterStatus, setShortbookFilterStatus] = useState<string>("all");
  const [shortbookViewMode, setShortbookViewMode] = useState<"all" | "manual" | "auto">("all");

  // Modals
  const [showAddMedicineModal, setShowAddMedicineModal] = useState(false);
  const [showAddBatchModal, setShowAddBatchModal] = useState(false);
  const [addBatchPreselectedItem, setAddBatchPreselectedItem] = useState<StockItem | null>(null);

  const [showEditMedicineModal, setShowEditMedicineModal] = useState(false);
  const [selectedMedicineToEdit, setSelectedMedicineToEdit] = useState<StockItem | null>(null);

  const [showEditBatchModal, setShowEditBatchModal] = useState(false);
  const [selectedBatchToEdit, setSelectedBatchToEdit] = useState<{ item: StockItem; batch: BatchInfo } | null>(null);

  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustBatchId, setAdjustBatchId] = useState("");
  const [adjustType, setAdjustType] = useState<"adjustment" | "damage" | "expiry_writeoff">("adjustment");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [submittingAdjust, setSubmittingAdjust] = useState(false);

  const [showAddShortbookModal, setShowAddShortbookModal] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [selectedDistributorForWhatsApp, setSelectedDistributorForWhatsApp] = useState<string>("all");

  // Form states for Add Medicine
  const [newMedName, setNewMedName] = useState("");
  const [newMedGeneric, setNewMedGeneric] = useState("");
  const [newMedManufacturer, setNewMedManufacturer] = useState("");
  const [newMedHsn, setNewMedHsn] = useState("3004");
  const [newMedSchedule, setNewMedSchedule] = useState<"none" | "H" | "H1" | "X" | "NDPS" | "OTC">("none");
  const [newMedBaseUnit, setNewMedBaseUnit] = useState("TAB");
  const [newMedPackSize, setNewMedPackSize] = useState("10");
  const [newMedPackUnit, setNewMedPackUnit] = useState("STRIP");
  const [newMedRack, setNewMedRack] = useState("");
  const [newMedBarcode, setNewMedBarcode] = useState("");
  const [newMedReorderLevel, setNewMedReorderLevel] = useState("20");
  const [newMedReorderQty, setNewMedReorderQty] = useState("100");
  const [includeInitialBatch, setIncludeInitialBatch] = useState(false);
  const [newBatchNo, setNewBatchNo] = useState("");
  const [newBatchExpiry, setNewBatchExpiry] = useState("");
  const [newBatchMrp, setNewBatchMrp] = useState("");
  const [newBatchPtr, setNewBatchPtr] = useState("");
  const [newBatchQty, setNewBatchQty] = useState("");
  const [submittingNewMed, setSubmittingNewMed] = useState(false);

  // Form states for Add Batch
  const [targetBatchItemId, setTargetBatchItemId] = useState("");
  const [targetBatchNo, setTargetBatchNo] = useState("");
  const [targetBatchExpiry, setTargetBatchExpiry] = useState("");
  const [targetBatchMrp, setTargetBatchMrp] = useState("");
  const [targetBatchPtr, setTargetBatchPtr] = useState("");
  const [targetBatchQty, setTargetBatchQty] = useState("");
  const [targetBatchMoveType, setTargetBatchMoveType] = useState<"opening" | "adjustment">("opening");
  const [submittingNewBatch, setSubmittingNewBatch] = useState(false);

  // Form states for Edit Medicine
  const [editMedName, setEditMedName] = useState("");
  const [editMedGeneric, setEditMedGeneric] = useState("");
  const [editMedRack, setEditMedRack] = useState("");
  const [editMedHsn, setEditMedHsn] = useState("");
  const [editMedReorderLevel, setEditMedReorderLevel] = useState("");
  const [editMedReorderQty, setEditMedReorderQty] = useState("");
  const [editMedSchedule, setEditMedSchedule] = useState<"none" | "H" | "H1" | "X" | "NDPS" | "OTC">("none");
  const [editMedBarcode, setEditMedBarcode] = useState("");
  const [submittingEditMed, setSubmittingEditMed] = useState(false);

  // Form states for Edit Batch
  const [editBatchNo, setEditBatchNo] = useState("");
  const [editBatchExpiry, setEditBatchExpiry] = useState("");
  const [editBatchMrp, setEditBatchMrp] = useState("");
  const [editBatchPtr, setEditBatchPtr] = useState("");
  const [editBatchPhysicalStock, setEditBatchPhysicalStock] = useState("");
  const [editBatchReason, setEditBatchReason] = useState("");
  const [submittingEditBatch, setSubmittingEditBatch] = useState(false);

  // Form states for Add Shortbook
  const [sbItemId, setSbItemId] = useState("");
  const [sbCustomName, setSbCustomName] = useState("");
  const [sbDistributorId, setSbDistributorId] = useState("");
  const [sbRequestedQty, setSbRequestedQty] = useState("10");
  const [sbPriority, setSbPriority] = useState<"low" | "normal" | "urgent">("normal");
  const [sbNotes, setSbNotes] = useState("");
  const [submittingSb, setSubmittingSb] = useState(false);

  // Fetch Inventory and Shortbook
  const fetchInventory = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/inventory");
      if (res.ok) {
        const data = await res.json();
        setStockGrid(data.stockGrid || []);
        setGrandCostPaise(data.grandCostPaise || 0);
        setGrandMrpPaise(data.grandMrpPaise || 0);
        setRecentMovements(data.recentMovements || []);
      }
    } catch (err) {
      console.error("Failed to fetch inventory", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchShortbook = async () => {
    try {
      const res = await fetch("/api/inventory/shortbook");
      if (res.ok) {
        const data = await res.json();
        setShortbookItems(data.shortbookItems || []);
        setLowStockItems(data.lowStockItems || []);
        setDistributors(data.distributors || []);
      }
    } catch (err) {
      console.error("Failed to fetch shortbook", err);
    }
  };

  useEffect(() => {
    fetchInventory();
    fetchShortbook();
  }, []);

  // Row Expand Toggle
  const toggleExpandItem = (itemId: string) => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  // Stock Adjustment Submission
  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustBatchId) {
      warning("Select Batch", "Please select a medicine batch to adjust.");
      return;
    }
    const rawQty = parseInt(adjustQty, 10);
    if (isNaN(rawQty) || rawQty === 0) {
      warning("Invalid Quantity", "Quantity must be non-zero.");
      return;
    }

    const qtySigned = adjustType === "damage" || adjustType === "expiry_writeoff" ? -Math.abs(rawQty) : rawQty;

    setSubmittingAdjust(true);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId: adjustBatchId,
          qtySigned,
          movementType: adjustType,
          reason: adjustReason.trim() || `Manual ${adjustType}`,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Adjustment failed");
      }

      success("Stock Adjusted", "Immutable stock movement record created.");
      setShowAdjustModal(false);
      setAdjustQty("");
      setAdjustReason("");
      fetchInventory();
    } catch (err: any) {
      error("Error", err.message || "Failed to adjust stock.");
    } finally {
      setSubmittingAdjust(false);
    }
  };

  // Add Medicine Master Submission
  const handleAddMedicineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMedName.trim()) {
      warning("Required Field", "Medicine name is required.");
      return;
    }

    setSubmittingNewMed(true);
    try {
      const payload: any = {
        name: newMedName.trim(),
        genericName: newMedGeneric.trim(),
        manufacturerName: newMedManufacturer.trim(),
        hsnCode: newMedHsn.trim() || "3004",
        schedule: newMedSchedule,
        baseUnit: newMedBaseUnit.trim() || "TAB",
        packSize: parseInt(newMedPackSize, 10) || 1,
        packUnit: newMedPackUnit.trim() || (parseInt(newMedPackSize, 10) > 1 ? "STRIP" : "TAB"),
        rackLocation: newMedRack.trim().toUpperCase(),
        barcode: newMedBarcode.trim(),
        reorderLevel: parseInt(newMedReorderLevel, 10) || 20,
        reorderQty: parseInt(newMedReorderQty, 10) || 100,
      };

      if (includeInitialBatch && newBatchNo.trim() && newBatchExpiry.trim()) {
        payload.initialBatch = {
          batchNo: newBatchNo.trim(),
          expiryDate: newBatchExpiry.trim(),
          mrp: parseFloat(newBatchMrp) || 0,
          ptr: parseFloat(newBatchPtr) || 0,
          quantity: parseInt(newBatchQty, 10) || 0,
        };
      }

      const res = await fetch("/api/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create medicine");
      }

      success("Medicine Created", `Master formulation "${newMedName}" added to catalog.`);
      setShowAddMedicineModal(false);
      // Reset form
      setNewMedName("");
      setNewMedGeneric("");
      setNewMedManufacturer("");
      setNewMedRack("");
      setNewMedBarcode("");
      setIncludeInitialBatch(false);
      setNewBatchNo("");
      setNewBatchExpiry("");
      setNewBatchMrp("");
      setNewBatchPtr("");
      setNewBatchQty("");

      fetchInventory();
      fetchShortbook();
    } catch (err: any) {
      error("Error", err.message || "Failed to add medicine.");
    } finally {
      setSubmittingNewMed(false);
    }
  };

  // Add / Restock Batch Submission
  const handleAddBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetBatchItemId) {
      warning("Select Medicine", "Please choose a medicine SKU.");
      return;
    }
    if (!targetBatchNo.trim()) {
      warning("Batch Number", "Batch number is required.");
      return;
    }
    if (!targetBatchExpiry.trim()) {
      warning("Expiry Date", "Expiry date is required.");
      return;
    }

    setSubmittingNewBatch(true);
    try {
      const res = await fetch("/api/inventory/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: targetBatchItemId,
          batchNo: targetBatchNo.trim(),
          expiryDate: targetBatchExpiry.trim(),
          mrp: parseFloat(targetBatchMrp) || 0,
          ptr: parseFloat(targetBatchPtr) || 0,
          quantity: parseInt(targetBatchQty, 10) || 0,
          movementType: targetBatchMoveType,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add batch");
      }

      success("Batch Recorded", `Batch ${targetBatchNo.toUpperCase()} created/restocked.`);
      setShowAddBatchModal(false);
      setTargetBatchItemId("");
      setTargetBatchNo("");
      setTargetBatchExpiry("");
      setTargetBatchMrp("");
      setTargetBatchPtr("");
      setTargetBatchQty("");
      setAddBatchPreselectedItem(null);

      fetchInventory();
    } catch (err: any) {
      error("Error", err.message || "Failed to add batch.");
    } finally {
      setSubmittingNewBatch(false);
    }
  };

  // Edit Medicine Master Submission
  const handleEditMedicineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMedicineToEdit) return;

    setSubmittingEditMed(true);
    try {
      const res = await fetch("/api/inventory/items", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selectedMedicineToEdit.id,
          name: editMedName.trim(),
          genericName: editMedGeneric.trim(),
          rackLocation: editMedRack.trim().toUpperCase(),
          hsnCode: editMedHsn.trim(),
          schedule: editMedSchedule,
          reorderLevel: parseInt(editMedReorderLevel, 10) || 0,
          reorderQty: parseInt(editMedReorderQty, 10) || 0,
          barcode: editMedBarcode.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update medicine");
      }

      success("Medicine Updated", `Master "${editMedName}" updated.`);
      setShowEditMedicineModal(false);
      setSelectedMedicineToEdit(null);
      fetchInventory();
      fetchShortbook();
    } catch (err: any) {
      error("Error", err.message || "Failed to update medicine.");
    } finally {
      setSubmittingEditMed(false);
    }
  };

  // Edit Batch Details & Direct Stock Audit
  const handleEditBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBatchToEdit) return;

    setSubmittingEditBatch(true);
    try {
      const payload: any = {
        batchId: selectedBatchToEdit.batch.batchId,
        batchNo: editBatchNo.trim(),
        expiryDate: editBatchExpiry.trim(),
        mrp: parseFloat(editBatchMrp) || 0,
        ptr: parseFloat(editBatchPtr) || 0,
      };

      if (editBatchPhysicalStock !== "") {
        payload.currentStock = parseInt(editBatchPhysicalStock, 10);
        payload.reason = editBatchReason.trim() || "Chemist Direct Physical Count Audit";
      }

      const res = await fetch("/api/inventory/batches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update batch");
      }

      success("Batch Updated", `Batch ${editBatchNo.toUpperCase()} corrected.`);
      setShowEditBatchModal(false);
      setSelectedBatchToEdit(null);
      fetchInventory();
    } catch (err: any) {
      error("Error", err.message || "Failed to update batch.");
    } finally {
      setSubmittingEditBatch(false);
    }
  };

  // Add Item to Shortbook
  const handleAddShortbookSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sbItemId && !sbCustomName.trim()) {
      warning("Specify Item", "Select an existing SKU or enter a custom item name.");
      return;
    }

    setSubmittingSb(true);
    try {
      const res = await fetch("/api/inventory/shortbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: sbItemId || undefined,
          customItemName: sbCustomName.trim(),
          distributorId: sbDistributorId || undefined,
          requestedQty: parseInt(sbRequestedQty, 10) || 10,
          priority: sbPriority,
          notes: sbNotes.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add shortbook item");
      }

      success("Added to Shortbook", "Item demand recorded in order diary.");
      setShowAddShortbookModal(false);
      setSbItemId("");
      setSbCustomName("");
      setSbDistributorId("");
      setSbRequestedQty("10");
      setSbNotes("");

      fetchShortbook();
    } catch (err: any) {
      error("Error", err.message || "Failed to add item to shortbook.");
    } finally {
      setSubmittingSb(false);
    }
  };

  // Update Shortbook Status
  const handleUpdateShortbookStatus = async (
    id: string,
    status: "pending" | "ordered" | "received" | "cancelled"
  ) => {
    try {
      const res = await fetch("/api/inventory/shortbook", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update status");
      }

      success("Status Updated", `Order status updated to ${status}.`);
      fetchShortbook();
    } catch (err: any) {
      error("Error", err.message || "Failed to update status.");
    }
  };

  // Filtered Stock Grid
  const filteredStock = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return stockGrid;
    return stockGrid.filter((item) => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.genericName.toLowerCase().includes(q) ||
        item.manufacturer.toLowerCase().includes(q) ||
        item.rackLocation.toLowerCase().includes(q) ||
        item.barcode.includes(q)
      );
    });
  }, [stockGrid, searchQuery]);

  // Flat Batches for Expiry Radar
  const allActiveBatches = useMemo(() => {
    return stockGrid.flatMap((item) =>
      item.batches.map((b) => ({
        ...b,
        medicineName: item.name,
        baseUnit: item.baseUnit,
        saleUnit: item.saleUnit,
        packSize: item.packSize,
        rackLocation: item.rackLocation,
      }))
    );
  }, [stockGrid]);

  const filteredBatches = useMemo(() => {
    return allActiveBatches
      .filter((b) => {
        if (b.stockBase <= 0) return false;
        if (expiryWindow === "expired") return b.daysLeft < 0;
        if (expiryWindow === "30") return b.daysLeft >= 0 && b.daysLeft <= 30;
        if (expiryWindow === "60") return b.daysLeft >= 0 && b.daysLeft <= 60;
        if (expiryWindow === "90") return b.daysLeft >= 0 && b.daysLeft <= 90;
        return true;
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [allActiveBatches, expiryWindow]);

  // Shortbook Consolidated List
  const consolidatedShortbookList = useMemo(() => {
    const list: Array<{
      id: string;
      title: string;
      generic: string;
      manufacturer: string;
      rack: string;
      currentStock: number;
      reorderLevel: number;
      requestedQty: number;
      unit: string;
      priority: "low" | "normal" | "urgent";
      status: "pending" | "ordered" | "received" | "cancelled";
      distributorName: string;
      distributorPhone: string;
      distributorId?: string;
      notes: string;
      isAuto: boolean;
      dateAdded: string;
    }> = [];

    // Manual shortbook items
    if (shortbookViewMode === "all" || shortbookViewMode === "manual") {
      for (const s of shortbookItems) {
        list.push({
          id: s.id,
          title: s.item_name || s.custom_item_name || "Custom Medicine Demand",
          generic: s.generic_name || "",
          manufacturer: s.manufacturer_name || "",
          rack: s.rack_location || "—",
          currentStock: s.current_stock_base ?? 0,
          reorderLevel: s.reorder_level ?? 0,
          requestedQty: s.requested_qty,
          unit: s.sale_unit || s.base_unit || "UNITS",
          priority: s.priority,
          status: s.status,
          distributorName: s.distributor_name || "Unassigned",
          distributorPhone: s.distributor_phone || "",
          distributorId: s.distributor_id || undefined,
          notes: s.notes || "",
          isAuto: false,
          dateAdded: s.created_at.slice(0, 10),
        });
      }
    }

    // Auto low-stock items that are not yet manually tracked
    if (shortbookViewMode === "all" || shortbookViewMode === "auto") {
      for (const a of lowStockItems) {
        if (!a.isAlreadyInShortbook) {
          list.push({
            id: `auto_${a.itemId}`,
            title: a.itemName,
            generic: a.genericName,
            manufacturer: a.manufacturer,
            rack: a.rackLocation,
            currentStock: a.currentStock,
            reorderLevel: a.reorderLevel,
            requestedQty: a.suggestedQty,
            unit: a.saleUnit || a.baseUnit,
            priority: a.priority,
            status: "pending",
            distributorName: "Auto Stock Trigger",
            distributorPhone: "",
            notes: "Catalog stock fell below reorder threshold",
            isAuto: true,
            dateAdded: new Date().toISOString().slice(0, 10),
          });
        }
      }
    }

    return list.filter((item) => {
      if (shortbookFilterStatus !== "all" && item.status !== shortbookFilterStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.generic.toLowerCase().includes(q) ||
          item.distributorName.toLowerCase().includes(q) ||
          item.rack.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [shortbookItems, lowStockItems, shortbookViewMode, shortbookFilterStatus, searchQuery]);

  // WhatsApp formatted order text generator
  const generatedWhatsAppOrderText = useMemo(() => {
    const today = new Date().toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    let itemsToInclude = consolidatedShortbookList.filter((item) => item.status === "pending" || item.status === "ordered");
    if (selectedDistributorForWhatsApp !== "all") {
      itemsToInclude = itemsToInclude.filter((i) => i.distributorId === selectedDistributorForWhatsApp);
    }

    const lines = [
      `*PHARMACY PURCHASE ORDER*`,
      `Date: ${today}`,
      `Ref: PharmaPilot Shortbook Order List`,
      `----------------------------------------`,
    ];

    if (itemsToInclude.length === 0) {
      lines.push(`(No pending items selected for order)`);
    } else {
      itemsToInclude.forEach((item, index) => {
        lines.push(
          `${index + 1}. *${item.title}* - Qty: ${item.requestedQty} ${item.unit} (Current Stock: ${item.currentStock})`
        );
        if (item.generic) {
          lines.push(`   Comp: ${item.generic}`);
        }
      });
    }

    lines.push(`----------------------------------------`);
    lines.push(`Total Items: ${itemsToInclude.length}`);
    lines.push(`Please confirm receipt and dispatch schedule. Thank you.`);

    return lines.join("\n");
  }, [consolidatedShortbookList, selectedDistributorForWhatsApp]);

  const copyWhatsAppToClipboard = () => {
    navigator.clipboard.writeText(generatedWhatsAppOrderText);
    success("Copied to Clipboard", "Shortbook order text copied for WhatsApp.");
  };

  const openWhatsAppUrl = () => {
    let phone = "";
    if (selectedDistributorForWhatsApp !== "all") {
      const dist = distributors.find((d) => d.id === selectedDistributorForWhatsApp);
      if (dist && dist.phone) {
        phone = dist.phone.replace(/[^0-9]/g, "");
        if (phone.length === 10) phone = `91${phone}`;
      }
    }
    const encoded = encodeURIComponent(generatedWhatsAppOrderText);
    const url = phone ? `https://wa.me/${phone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-4 max-w-7xl mx-auto select-none">
      {/* Top Header & Master Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-navy-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-navy-900 dark:text-slate-100">
              Inventory & Batch Management
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
              Chemist Authority
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Formulation masters, multi-batch FEFO tracking, physical count audit corrections, and shortbook order diary.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              fetchInventory();
              fetchShortbook();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-teal-600" : "text-slate-500"}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={() => setShowAdjustModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 shadow-sm transition-colors"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
            <span>Physical Count Adjustment</span>
          </button>

          <button
            onClick={() => {
              setTargetBatchItemId("");
              setAddBatchPreselectedItem(null);
              setShowAddBatchModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-teal-600 text-teal-700 dark:text-teal-400 bg-teal-50/50 dark:bg-teal-950/40 hover:bg-teal-100/50 shadow-sm transition-colors"
          >
            <PackagePlus className="w-3.5 h-3.5" />
            <span>+ Restock / Add Batch</span>
          </button>

          <button
            onClick={() => setShowAddMedicineModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>+ Add Medicine</span>
          </button>
        </div>
      </div>

      {/* Valuation & Metric Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Valuation @ Cost (PTR)
          </span>
          <div className="mt-1 text-lg font-bold font-mono text-navy-900 dark:text-slate-100 tabular-nums">
            {formatINR(grandCostPaise)}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Valuation @ Retail (MRP)
          </span>
          <div className="mt-1 text-lg font-bold font-mono text-teal-700 dark:text-teal-400 tabular-nums">
            {formatINR(grandMrpPaise)}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Active Catalog SKUs
          </span>
          <div className="mt-1 text-lg font-bold font-mono text-navy-900 dark:text-slate-100 tabular-nums">
            {stockGrid.length} Formulations
          </div>
        </div>

        <div
          onClick={() => setActiveTab("shortbook")}
          className="p-3 rounded-lg bg-white dark:bg-navy-800 border border-amber-200 dark:border-amber-900/60 shadow-sm cursor-pointer hover:bg-amber-50/40 dark:hover:bg-amber-950/20 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-amber-800 dark:text-amber-400">
              Shortbook & Low Stock
            </span>
            <BookOpen className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="mt-1 text-lg font-bold font-mono text-amber-700 dark:text-amber-300 tabular-nums">
            {consolidatedShortbookList.filter((s) => s.status === "pending").length} Items Pending
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-navy-800">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("stock")}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "stock"
                ? "border-teal-600 text-teal-700 dark:text-teal-400"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            Real-Time Stock Grid
          </button>
          <button
            onClick={() => setActiveTab("expiry")}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "expiry"
                ? "border-teal-600 text-teal-700 dark:text-teal-400"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Clock className="w-3.5 h-3.5 stroke-[2]" />
            <span>Expiry Radar</span>
          </button>
          <button
            onClick={() => setActiveTab("shortbook")}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "shortbook"
                ? "border-teal-600 text-teal-700 dark:text-teal-400"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 stroke-[2]" />
            <span>Shortbook (Order Diary)</span>
            {consolidatedShortbookList.filter((s) => s.status === "pending").length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                {consolidatedShortbookList.filter((s) => s.status === "pending").length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("ledger")}
            className={`px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "ledger"
                ? "border-teal-600 text-teal-700 dark:text-teal-400"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <History className="w-3.5 h-3.5 stroke-[2]" />
            <span>Stock Ledger</span>
          </button>
        </div>

        {/* Search input */}
        <div className="relative w-64 pb-1">
          <input
            type="text"
            placeholder="Search medicine, rack, barcode..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs rounded-md border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 focus:outline-none focus:border-teal-500"
          />
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
        </div>
      </div>

      {/* Tab 1: Stock Grid with Expandable Batches & Row Actions */}
      {activeTab === "stock" && (
        <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3 w-8"></th>
                  <th className="py-2.5 px-3">Medicine & Salt</th>
                  <th className="py-2.5 px-3">Manufacturer</th>
                  <th className="py-2.5 px-2 text-center">Rack</th>
                  <th className="py-2.5 px-2 text-center">Nearest Exp</th>
                  <th className="py-2.5 px-3 text-right">Current Stock</th>
                  <th className="py-2.5 px-3 text-right">Cost (PTR)</th>
                  <th className="py-2.5 px-3 text-right">Retail (MRP)</th>
                  <th className="py-2.5 px-3 text-center">Batches</th>
                  <th className="py-2.5 px-3 text-right">Chemist Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {filteredStock.map((item) => {
                  const isExpanded = expandedItemIds.has(item.id);
                  const smartStockStr = formatSmartStock(item.currentStockBase, item.baseUnit, {
                    unitName: item.saleUnit,
                    qtyInBaseUnit: item.packSize,
                  });

                  return (
                    <React.Fragment key={item.id}>
                      <tr
                        className={`transition-colors cursor-pointer ${
                          isExpanded
                            ? "bg-slate-50/90 dark:bg-navy-750"
                            : "hover:bg-slate-50/70 dark:hover:bg-navy-750"
                        }`}
                        onClick={() => toggleExpandItem(item.id)}
                      >
                        <td className="py-2.5 px-2 text-center text-slate-400">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 text-teal-600 inline" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 inline" />
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-navy-900 dark:text-slate-100">{item.name}</span>
                            {item.schedule !== "none" && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800">
                                Sched {item.schedule}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">{item.genericName}</div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{item.manufacturer}</td>
                        <td className="py-2.5 px-2 text-center font-mono font-medium text-slate-700 dark:text-slate-300">
                          {item.rackLocation}
                        </td>
                        <td className="py-2.5 px-2 text-center font-mono text-slate-600 dark:text-slate-400">
                          {item.nearestExpiry}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                          {smartStockStr}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-600 dark:text-slate-300">
                          {formatINR(item.costValuationPaise)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-teal-700 dark:text-teal-400">
                          {formatINR(item.mrpValuationPaise)}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 dark:bg-navy-700 text-slate-700 dark:text-slate-300">
                            {item.batches.length} {item.batches.length === 1 ? "Batch" : "Batches"}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setSelectedMedicineToEdit(item);
                                setEditMedName(item.name);
                                setEditMedGeneric(item.genericName);
                                setEditMedRack(item.rackLocation);
                                setEditMedHsn(item.hsnCode || "3004");
                                setEditMedReorderLevel(String(item.reorderLevel));
                                setEditMedReorderQty(String(item.reorderQty));
                                setEditMedSchedule((item.schedule as any) || "none");
                                setEditMedBarcode(item.barcode || "");
                                setShowEditMedicineModal(true);
                              }}
                              title="Edit Formulation Master"
                              className="p-1 rounded text-slate-500 hover:text-navy-900 hover:bg-slate-200/60 dark:hover:bg-navy-700"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setTargetBatchItemId(item.id);
                                setAddBatchPreselectedItem(item);
                                setShowAddBatchModal(true);
                              }}
                              title="Add Batch to this Medicine"
                              className="px-2 py-1 text-[11px] font-medium rounded border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/40 hover:bg-teal-100/60"
                            >
                              + Batch
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Batches Subtable */}
                      {isExpanded && (
                        <tr className="bg-slate-50/50 dark:bg-navy-900/40">
                          <td colSpan={10} className="py-3 px-6 border-y border-slate-200 dark:border-navy-700">
                            <div className="bg-white dark:bg-navy-800 rounded-md border border-slate-200 dark:border-navy-700 p-3 shadow-sm">
                              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100 dark:border-navy-700 text-xs">
                                <span className="font-semibold text-slate-700 dark:text-slate-200">
                                  Batches for {item.name} (Base: {item.baseUnit}, Pack: {item.saleUnit} of {item.packSize})
                                </span>
                                <button
                                  onClick={() => {
                                    setTargetBatchItemId(item.id);
                                    setAddBatchPreselectedItem(item);
                                    setShowAddBatchModal(true);
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600 hover:text-teal-700"
                                >
                                  <Plus className="w-3 h-3 stroke-[2.5]" />
                                  <span>Add New Batch</span>
                                </button>
                              </div>

                              {item.batches.length === 0 ? (
                                <div className="text-center py-4 text-xs text-slate-400">
                                  No batches recorded for this medicine formulation yet.
                                </div>
                              ) : (
                                <table className="w-full text-xs text-left">
                                  <thead className="text-[10px] uppercase font-semibold text-slate-400 border-b border-slate-100 dark:border-navy-700">
                                    <tr>
                                      <th className="py-1.5 px-2">Batch No</th>
                                      <th className="py-1.5 px-2">Expiry Date</th>
                                      <th className="py-1.5 px-2 text-center">Status</th>
                                      <th className="py-1.5 px-2 text-right">MRP (₹)</th>
                                      <th className="py-1.5 px-2 text-right">PTR (₹)</th>
                                      <th className="py-1.5 px-2 text-right">Available Stock</th>
                                      <th className="py-1.5 px-2 text-right">Action</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                                    {item.batches.map((b) => (
                                      <tr key={b.batchId} className="hover:bg-slate-50 dark:hover:bg-navy-750">
                                        <td className="py-1.5 px-2 font-mono font-medium text-slate-800 dark:text-slate-200">
                                          {b.batchNo}
                                        </td>
                                        <td className="py-1.5 px-2 font-mono text-slate-600 dark:text-slate-400">
                                          {b.expiryDate}
                                        </td>
                                        <td className="py-1.5 px-2 text-center">
                                          <span
                                            className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-bold font-mono ${
                                              b.daysLeft < 0
                                                ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                                                : b.daysLeft <= 60
                                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                                : "bg-slate-100 text-slate-700 dark:bg-navy-700 dark:text-slate-300"
                                            }`}
                                          >
                                            {b.daysLeft < 0 ? "EXPIRED" : `${b.daysLeft}d left`}
                                          </span>
                                        </td>
                                        <td className="py-1.5 px-2 text-right font-mono">
                                          {formatINR(b.mrpPaise)}
                                        </td>
                                        <td className="py-1.5 px-2 text-right font-mono text-slate-600 dark:text-slate-400">
                                          {formatINR(b.ptrPaise)}
                                        </td>
                                        <td className="py-1.5 px-2 text-right font-mono font-semibold">
                                          {b.stockBase} {item.baseUnit}
                                        </td>
                                        <td className="py-1.5 px-2 text-right">
                                          <button
                                            onClick={() => {
                                              setSelectedBatchToEdit({ item, batch: b });
                                              setEditBatchNo(b.batchNo);
                                              setEditBatchExpiry(b.expiryDate);
                                              setEditBatchMrp(paiseToRupeesStr(b.mrpPaise));
                                              setEditBatchPtr(paiseToRupeesStr(b.ptrPaise));
                                              setEditBatchPhysicalStock(String(b.stockBase));
                                              setEditBatchReason("");
                                              setShowEditBatchModal(true);
                                            }}
                                            className="px-2 py-0.5 text-[11px] font-medium rounded border border-slate-200 dark:border-navy-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-navy-700"
                                          >
                                            Edit Batch
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Expiry Radar with 30/60/90 Day Filters */}
      {activeTab === "expiry" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Expiry Window:</span>
            {[
              { key: "all", label: "All Active Batches" },
              { key: "expired", label: "Expired (< 0d)" },
              { key: "30", label: "< 30 Days" },
              { key: "60", label: "< 60 Days" },
              { key: "90", label: "< 90 Days" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setExpiryWindow(tab.key as any)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  expiryWindow === tab.key
                    ? "bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 font-semibold"
                    : "bg-white dark:bg-navy-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-navy-700 hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Medicine</th>
                  <th className="py-2.5 px-3">Batch No</th>
                  <th className="py-2.5 px-3">Expiry Date</th>
                  <th className="py-2.5 px-2 text-center">Days Remaining</th>
                  <th className="py-2.5 px-3 text-right">Available Stock</th>
                  <th className="py-2.5 px-3 text-right">At-Risk Cost (PTR)</th>
                  <th className="py-2.5 px-3 text-center">Chemist Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700">
                {filteredBatches.map((b) => (
                  <tr key={b.batchId} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                    <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">
                      {b.medicineName}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-medium text-slate-700 dark:text-slate-300">
                      {b.batchNo}
                    </td>
                    <td className="py-2.5 px-3 font-mono">{b.expiryDate}</td>
                    <td className="py-2.5 px-2 text-center font-mono">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                          b.daysLeft < 0
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                            : b.daysLeft <= 60
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-slate-100 text-slate-700 dark:bg-navy-700 dark:text-slate-300"
                        }`}
                      >
                        {b.daysLeft < 0 ? "EXPIRED" : `${b.daysLeft}d left`}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold">
                      {b.stockBase} {b.baseUnit}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      {formatINR(Math.round((b.ptrPaise / b.packSize) * b.stockBase))}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <button
                        onClick={() => {
                          setAdjustBatchId(b.batchId);
                          setAdjustType(b.daysLeft < 0 ? "expiry_writeoff" : "damage");
                          setAdjustQty(String(b.stockBase));
                          setAdjustReason(`Expiry writeoff for Batch ${b.batchNo}`);
                          setShowAdjustModal(true);
                        }}
                        className="px-2 py-1 text-[11px] font-medium rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                      >
                        Write Off
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Shortbook (Order Diary) */}
      {activeTab === "shortbook" && (
        <div className="space-y-3">
          {/* Action Bar for Shortbook */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white dark:bg-navy-800 rounded-lg border border-slate-200 dark:border-navy-700 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">View:</span>
              {[
                { key: "all", label: "All Items" },
                { key: "manual", label: "Manual Entries" },
                { key: "auto", label: "Auto Low-Stock" },
              ].map((m) => (
                <button
                  key={m.key}
                  onClick={() => setShortbookViewMode(m.key as any)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                    shortbookViewMode === m.key
                      ? "bg-teal-600 text-white font-semibold"
                      : "bg-slate-100 dark:bg-navy-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                  }`}
                >
                  {m.label}
                </button>
              ))}

              <span className="ml-2 text-xs font-semibold text-slate-600 dark:text-slate-400">Status:</span>
              {["all", "pending", "ordered", "received"].map((s) => (
                <button
                  key={s}
                  onClick={() => setShortbookFilterStatus(s)}
                  className={`px-2.5 py-1 text-xs rounded uppercase font-mono font-medium transition-colors ${
                    shortbookFilterStatus === s
                      ? "bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-semibold"
                      : "bg-slate-100 dark:bg-navy-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowWhatsAppModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span>Share via WhatsApp</span>
              </button>

              <button
                onClick={() => setShowAddShortbookModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>+ Add Item</span>
              </button>
            </div>
          </div>

          {/* Shortbook Items Table */}
          <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-2.5 px-3">Item & Composition</th>
                  <th className="py-2.5 px-2 text-center">Priority</th>
                  <th className="py-2.5 px-2 text-center">Rack</th>
                  <th className="py-2.5 px-3 text-right">Current / Reorder</th>
                  <th className="py-2.5 px-3 text-right">Order Qty</th>
                  <th className="py-2.5 px-3">Distributor</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Quick WhatsApp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
                {consolidatedShortbookList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-400">
                      No shortbook order diary entries matching your filter criteria.
                    </td>
                  </tr>
                ) : (
                  consolidatedShortbookList.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-navy-900 dark:text-slate-100">{entry.title}</span>
                          {entry.isAuto && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950 dark:text-sky-300">
                              Auto Low Stock
                            </span>
                          )}
                        </div>
                        {entry.generic && <div className="text-[10px] text-slate-400">{entry.generic}</div>}
                        {entry.notes && <div className="text-[10px] text-slate-500 italic mt-0.5">{entry.notes}</div>}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                            entry.priority === "urgent"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              : entry.priority === "normal"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                              : "bg-slate-100 text-slate-700 dark:bg-navy-700 dark:text-slate-300"
                          }`}
                        >
                          {entry.priority}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-center font-mono text-slate-600 dark:text-slate-300">
                        {entry.rack}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        <span
                          className={`font-bold ${
                            entry.currentStock === 0 ? "text-rose-600" : "text-amber-600 dark:text-amber-400"
                          }`}
                        >
                          {entry.currentStock}
                        </span>
                        <span className="text-slate-400"> / {entry.reorderLevel}</span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-navy-900 dark:text-slate-100">
                        {entry.requestedQty} {entry.unit}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-800 dark:text-slate-200">{entry.distributorName}</div>
                        {entry.distributorPhone && (
                          <div className="text-[10px] font-mono text-slate-400">{entry.distributorPhone}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <select
                          value={entry.status}
                          onChange={(e: any) => handleUpdateShortbookStatus(entry.id, e.target.value)}
                          className="h-7 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 text-[11px] font-medium font-mono"
                        >
                          <option value="pending">Pending</option>
                          <option value="ordered">Ordered</option>
                          <option value="received">Received</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {entry.distributorPhone ? (
                          <button
                            onClick={() => {
                              const cleanPhone = entry.distributorPhone.replace(/[^0-9]/g, "");
                              const fullPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
                              const text = encodeURIComponent(
                                `*PHARMACY ORDER*\nItem: ${entry.title}\nQty: ${entry.requestedQty} ${entry.unit}\nPlease dispatch. Thanks.`
                              );
                              window.open(`https://wa.me/${fullPhone}?text=${text}`, "_blank");
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                            title="Direct WhatsApp to stockist"
                          >
                            <Send className="w-3 h-3" />
                            <span>WhatsApp</span>
                          </button>
                        ) : (
                          <span className="text-slate-400 text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Immutable Stock Movements Ledger */}
      {activeTab === "ledger" && (
        <div className="rounded-lg bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-700 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-navy-700 bg-slate-50/50 dark:bg-navy-900/30">
            <span className="text-xs font-semibold text-navy-900 dark:text-slate-100">
              Audit Stock Ledger (Immutable stock_movements)
            </span>
          </div>

          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-navy-900/50 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-navy-700 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Medicine</th>
                <th className="py-2.5 px-2 text-center">Batch</th>
                <th className="py-2.5 px-2 text-center">Movement Type</th>
                <th className="py-2.5 px-3 text-right">Qty (Base)</th>
                <th className="py-2.5 px-3">Doc Ref</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-navy-700 font-sans">
              {recentMovements.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/70 dark:hover:bg-navy-750 transition-colors">
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">
                    {m.created_at.replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-navy-900 dark:text-slate-100">
                    {m.item_name}
                  </td>
                  <td className="py-2.5 px-2 text-center font-mono">{m.batch_no}</td>
                  <td className="py-2.5 px-2 text-center">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase font-mono ${
                        m.qty_base_signed > 0
                          ? "bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300"
                          : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                      }`}
                    >
                      {m.movement_type}
                    </span>
                  </td>
                  <td
                    className={`py-2.5 px-3 text-right font-mono font-bold ${
                      m.qty_base_signed > 0 ? "text-teal-700 dark:text-teal-400" : "text-rose-700 dark:text-rose-400"
                    }`}
                  >
                    {m.qty_base_signed > 0 ? `+${m.qty_base_signed}` : m.qty_base_signed} {m.base_unit}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-500">{m.ref_doc_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL 1: ADD MEDICINE MASTER */}
      {/* ---------------------------------------------------------------------- */}
      {showAddMedicineModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-slate-200 dark:border-navy-700 p-5 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-800">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-teal-600" />
                <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                  New Medicine Master Formulation
                </h3>
              </div>
              <button onClick={() => setShowAddMedicineModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddMedicineSubmit} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Medicine Name * (e.g. Augmentin 625 Duo Tablet)
                </label>
                <input
                  type="text"
                  required
                  value={newMedName}
                  onChange={(e) => setNewMedName(e.target.value)}
                  placeholder="Brand / Commercial Name"
                  className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Generic Composition / Active Salts
                </label>
                <input
                  type="text"
                  value={newMedGeneric}
                  onChange={(e) => setNewMedGeneric(e.target.value)}
                  placeholder="e.g. Amoxicillin 500mg + Clavulanic Acid 125mg"
                  className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Manufacturer / Company
                  </label>
                  <input
                    type="text"
                    value={newMedManufacturer}
                    onChange={(e) => setNewMedManufacturer(e.target.value)}
                    placeholder="e.g. GlaxoSmithKline"
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    HSN Code
                  </label>
                  <input
                    type="text"
                    value={newMedHsn}
                    onChange={(e) => setNewMedHsn(e.target.value)}
                    placeholder="3004"
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Schedule
                  </label>
                  <select
                    value={newMedSchedule}
                    onChange={(e: any) => setNewMedSchedule(e.target.value)}
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                  >
                    <option value="none">None (General)</option>
                    <option value="H">Schedule H</option>
                    <option value="H1">Schedule H1</option>
                    <option value="X">Schedule X</option>
                    <option value="NDPS">NDPS</option>
                    <option value="OTC">OTC</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Base Unit
                  </label>
                  <select
                    value={newMedBaseUnit}
                    onChange={(e) => setNewMedBaseUnit(e.target.value)}
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  >
                    <option value="TAB">TAB</option>
                    <option value="CAP">CAP</option>
                    <option value="ML">ML</option>
                    <option value="BOTTLE">BOTTLE</option>
                    <option value="VIAL">VIAL</option>
                    <option value="SYRUP">SYRUP</option>
                    <option value="TUBE">TUBE</option>
                    <option value="INJ">INJ</option>
                    <option value="GM">GM</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Pack Size (Qty)
                  </label>
                  <input
                    type="number"
                    value={newMedPackSize}
                    onChange={(e) => setNewMedPackSize(e.target.value)}
                    placeholder="10"
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Rack Location
                  </label>
                  <input
                    type="text"
                    value={newMedRack}
                    onChange={(e) => setNewMedRack(e.target.value)}
                    placeholder="e.g. RACK-B2"
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Reorder Level
                  </label>
                  <input
                    type="number"
                    value={newMedReorderLevel}
                    onChange={(e) => setNewMedReorderLevel(e.target.value)}
                    placeholder="20"
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Barcode (Optional)
                  </label>
                  <input
                    type="text"
                    value={newMedBarcode}
                    onChange={(e) => setNewMedBarcode(e.target.value)}
                    placeholder="890..."
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              {/* Initial Batch Checkbox Section */}
              <div className="pt-2 border-t border-slate-200 dark:border-navy-800">
                <label className="flex items-center gap-2 cursor-pointer font-semibold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeInitialBatch}
                    onChange={(e) => setIncludeInitialBatch(e.target.checked)}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span>Add Opening Batch immediately with this medicine</span>
                </label>

                {includeInitialBatch && (
                  <div className="mt-2.5 p-3 rounded bg-slate-50 dark:bg-navy-800/80 border border-slate-200 dark:border-navy-700 space-y-2.5">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                          Batch No *
                        </label>
                        <input
                          type="text"
                          required={includeInitialBatch}
                          value={newBatchNo}
                          onChange={(e) => setNewBatchNo(e.target.value)}
                          placeholder="e.g. B25K01"
                          className="w-full h-7 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                          Expiry Date * (MM/YY or YYYY-MM-DD)
                        </label>
                        <input
                          type="text"
                          required={includeInitialBatch}
                          value={newBatchExpiry}
                          onChange={(e) => setNewBatchExpiry(e.target.value)}
                          placeholder="06/28"
                          className="w-full h-7 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                          MRP (₹) *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          required={includeInitialBatch}
                          value={newBatchMrp}
                          onChange={(e) => setNewBatchMrp(e.target.value)}
                          placeholder="120.00"
                          className="w-full h-7 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                          PTR (₹) *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          required={includeInitialBatch}
                          value={newBatchPtr}
                          onChange={(e) => setNewBatchPtr(e.target.value)}
                          placeholder="85.50"
                          className="w-full h-7 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                          Opening Qty ({newMedBaseUnit})
                        </label>
                        <input
                          type="number"
                          value={newBatchQty}
                          onChange={(e) => setNewBatchQty(e.target.value)}
                          placeholder="100"
                          className="w-full h-7 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-900 font-mono"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-navy-800">
                <button
                  type="button"
                  onClick={() => setShowAddMedicineModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-navy-700 text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingNewMed}
                  className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
                >
                  Save Formulation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL 2: ADD / RESTOCK BATCH */}
      {/* ---------------------------------------------------------------------- */}
      {showAddBatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-slate-200 dark:border-navy-700 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-800">
              <div className="flex items-center gap-2">
                <PackagePlus className="w-4 h-4 text-teal-600" />
                <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                  Add / Restock Batch
                </h3>
              </div>
              <button onClick={() => setShowAddBatchModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddBatchSubmit} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Medicine Formulation *
                </label>
                {addBatchPreselectedItem ? (
                  <div className="p-2 rounded bg-slate-50 dark:bg-navy-800 border border-slate-200 dark:border-navy-700 font-semibold text-navy-900 dark:text-slate-100">
                    {addBatchPreselectedItem.name} ({addBatchPreselectedItem.baseUnit})
                  </div>
                ) : (
                  <select
                    required
                    value={targetBatchItemId}
                    onChange={(e) => setTargetBatchItemId(e.target.value)}
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                  >
                    <option value="">Select formulation...</option>
                    {stockGrid.map((itm) => (
                      <option key={itm.id} value={itm.id}>
                        {itm.name} · {itm.manufacturer} ({itm.baseUnit})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Batch Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={targetBatchNo}
                    onChange={(e) => setTargetBatchNo(e.target.value)}
                    placeholder="e.g. TL25C10"
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Expiry Date * (MM/YY or YYYY-MM-DD)
                  </label>
                  <input
                    type="text"
                    required
                    value={targetBatchExpiry}
                    onChange={(e) => setTargetBatchExpiry(e.target.value)}
                    placeholder="08/28"
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    MRP in ₹ *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={targetBatchMrp}
                    onChange={(e) => setNewBatchMrp(e.target.value)}
                    placeholder="e.g. 240.00"
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    PTR in ₹ *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={targetBatchPtr}
                    onChange={(e) => setTargetBatchPtr(e.target.value)}
                    placeholder="e.g. 171.40"
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Quantity to Add (Base Units)
                  </label>
                  <input
                    type="number"
                    value={targetBatchQty}
                    onChange={(e) => setTargetBatchQty(e.target.value)}
                    placeholder="e.g. 150"
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Stock Movement Type
                  </label>
                  <select
                    value={targetBatchMoveType}
                    onChange={(e: any) => setTargetBatchMoveType(e.target.value)}
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                  >
                    <option value="opening">Opening Stock</option>
                    <option value="adjustment">Stock Adjustment</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-navy-800">
                <button
                  type="button"
                  onClick={() => setShowAddBatchModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-navy-700 text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingNewBatch}
                  className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
                >
                  Record Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL 3: EDIT MEDICINE MASTER */}
      {/* ---------------------------------------------------------------------- */}
      {showEditMedicineModal && selectedMedicineToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-slate-200 dark:border-navy-700 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-800">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-teal-600" />
                <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                  Edit Formulation Master
                </h3>
              </div>
              <button onClick={() => setShowEditMedicineModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditMedicineSubmit} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Medicine Name *
                </label>
                <input
                  type="text"
                  required
                  value={editMedName}
                  onChange={(e) => setEditMedName(e.target.value)}
                  className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-semibold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Generic Composition / Salts
                </label>
                <input
                  type="text"
                  value={editMedGeneric}
                  onChange={(e) => setEditMedGeneric(e.target.value)}
                  className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Rack Location
                  </label>
                  <input
                    type="text"
                    value={editMedRack}
                    onChange={(e) => setEditMedRack(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    HSN Code
                  </label>
                  <input
                    type="text"
                    value={editMedHsn}
                    onChange={(e) => setEditMedHsn(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Reorder Level
                  </label>
                  <input
                    type="number"
                    value={editMedReorderLevel}
                    onChange={(e) => setEditMedReorderLevel(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Reorder Quantity
                  </label>
                  <input
                    type="number"
                    value={editMedReorderQty}
                    onChange={(e) => setEditMedReorderQty(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Schedule Classification
                  </label>
                  <select
                    value={editMedSchedule}
                    onChange={(e: any) => setEditMedSchedule(e.target.value)}
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                  >
                    <option value="none">None (General)</option>
                    <option value="H">Schedule H</option>
                    <option value="H1">Schedule H1</option>
                    <option value="X">Schedule X</option>
                    <option value="NDPS">NDPS</option>
                    <option value="OTC">OTC</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Barcode
                  </label>
                  <input
                    type="text"
                    value={editMedBarcode}
                    onChange={(e) => setEditMedBarcode(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-navy-800">
                <button
                  type="button"
                  onClick={() => setShowEditMedicineModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-navy-700 text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingEditMed}
                  className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
                >
                  Update Master
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL 4: EDIT BATCH & DIRECT STOCK CORRECTION */}
      {/* ---------------------------------------------------------------------- */}
      {showEditBatchModal && selectedBatchToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-slate-200 dark:border-navy-700 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-800">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-teal-600" />
                <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                  Edit Batch Details & Stock Correction
                </h3>
              </div>
              <button onClick={() => setShowEditBatchModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditBatchSubmit} className="space-y-3 mt-4 text-xs">
              <div className="p-2 rounded bg-slate-50 dark:bg-navy-800/80 border border-slate-200 dark:border-navy-700">
                <div className="font-semibold text-navy-900 dark:text-slate-100">
                  {selectedBatchToEdit.item.name}
                </div>
                <div className="text-[10px] text-slate-500">
                  Base Unit: {selectedBatchToEdit.item.baseUnit} · Pack: {selectedBatchToEdit.item.saleUnit} ({selectedBatchToEdit.item.packSize})
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Batch Number
                  </label>
                  <input
                    type="text"
                    required
                    value={editBatchNo}
                    onChange={(e) => setEditBatchNo(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Expiry Date (MM/YY or YYYY-MM-DD)
                  </label>
                  <input
                    type="text"
                    required
                    value={editBatchExpiry}
                    onChange={(e) => setEditBatchExpiry(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    MRP in ₹
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editBatchMrp}
                    onChange={(e) => setEditBatchMrp(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    PTR in ₹
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={editBatchPtr}
                    onChange={(e) => setEditBatchPtr(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
              </div>

              {/* Direct Stock Audit Correction */}
              <div className="p-3 rounded-lg bg-teal-50/60 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-teal-900 dark:text-teal-200">
                    Physical Count Correction
                  </span>
                  <span className="text-[10px] font-mono text-teal-700 dark:text-teal-400">
                    System Stock: {selectedBatchToEdit.batch.stockBase} {selectedBatchToEdit.item.baseUnit}
                  </span>
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-teal-900 dark:text-teal-200 mb-1">
                    Actual Physical Count on Shelf ({selectedBatchToEdit.item.baseUnit})
                  </label>
                  <input
                    type="number"
                    value={editBatchPhysicalStock}
                    onChange={(e) => setEditBatchPhysicalStock(e.target.value)}
                    className="w-full h-8 px-2.5 rounded border border-teal-300 dark:border-teal-700 bg-white dark:bg-navy-900 font-mono font-bold"
                  />
                </div>

                {editBatchPhysicalStock !== "" && (
                  <div className="text-[11px] font-mono">
                    Adjustment variance:{" "}
                    <span
                      className={`font-bold ${
                        parseInt(editBatchPhysicalStock, 10) - selectedBatchToEdit.batch.stockBase >= 0
                          ? "text-teal-700 dark:text-teal-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {parseInt(editBatchPhysicalStock, 10) - selectedBatchToEdit.batch.stockBase >= 0 ? "+" : ""}
                      {parseInt(editBatchPhysicalStock, 10) - selectedBatchToEdit.batch.stockBase}{" "}
                      {selectedBatchToEdit.item.baseUnit}
                    </span>
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-semibold text-teal-900 dark:text-teal-200 mb-1">
                    Audit Note / Reason
                  </label>
                  <input
                    type="text"
                    value={editBatchReason}
                    onChange={(e) => setEditBatchReason(e.target.value)}
                    placeholder="Shelf physical count audit"
                    className="w-full h-7 px-2 rounded border border-teal-200 dark:border-teal-800 bg-white dark:bg-navy-900 text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-navy-800">
                <button
                  type="button"
                  onClick={() => setShowEditBatchModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-navy-700 text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingEditBatch}
                  className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
                >
                  Save Corrections
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL 5: ADD SHORTBOOK ITEM */}
      {/* ---------------------------------------------------------------------- */}
      {showAddShortbookModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-slate-200 dark:border-navy-700 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-800">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-teal-600" />
                <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                  Add Item to Shortbook (Order Diary)
                </h3>
              </div>
              <button onClick={() => setShowAddShortbookModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddShortbookSubmit} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Choose from Existing Catalog Formulation
                </label>
                <select
                  value={sbItemId}
                  onChange={(e) => {
                    setSbItemId(e.target.value);
                    if (e.target.value) setSbCustomName("");
                  }}
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                >
                  <option value="">-- Or enter custom customer request below --</option>
                  {stockGrid.map((itm) => (
                    <option key={itm.id} value={itm.id}>
                      {itm.name} (Stock: {itm.currentStockBase} {itm.baseUnit})
                    </option>
                  ))}
                </select>
              </div>

              {!sbItemId && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Custom Medicine / Non-Catalog Request
                  </label>
                  <input
                    type="text"
                    value={sbCustomName}
                    onChange={(e) => setSbCustomName(e.target.value)}
                    placeholder="e.g. Rare ointment or patient specific brand"
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Requested Order Quantity *
                  </label>
                  <input
                    type="number"
                    required
                    value={sbRequestedQty}
                    onChange={(e) => setSbRequestedQty(e.target.value)}
                    placeholder="10"
                    className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Order Priority
                  </label>
                  <select
                    value={sbPriority}
                    onChange={(e: any) => setSbPriority(e.target.value)}
                    className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                  >
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent (Stock Out / Patient Waiting)</option>
                    <option value="low">Low (Buffer)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Assign Stockist / Distributor (Optional)
                </label>
                <select
                  value={sbDistributorId}
                  onChange={(e) => setSbDistributorId(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                >
                  <option value="">None / Open for any distributor</option>
                  {distributors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.phone ? `(${d.phone})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Chemist Note / Customer Reference
                </label>
                <input
                  type="text"
                  value={sbNotes}
                  onChange={(e) => setSbNotes(e.target.value)}
                  placeholder="e.g. Needed for Rx order #108 by Tuesday"
                  className="w-full h-8 px-2.5 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-navy-800">
                <button
                  type="button"
                  onClick={() => setShowAddShortbookModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-navy-700 text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingSb}
                  className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
                >
                  Save to Shortbook
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL 6: WHATSAPP ORDER SHARE PREVIEW */}
      {/* ---------------------------------------------------------------------- */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-slate-200 dark:border-navy-700 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-800">
              <div className="flex items-center gap-2">
                <Share2 className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                  Share Order via WhatsApp
                </h3>
              </div>
              <button onClick={() => setShowWhatsAppModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Target Distributor Filter
                </label>
                <select
                  value={selectedDistributorForWhatsApp}
                  onChange={(e) => setSelectedDistributorForWhatsApp(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-white dark:bg-navy-800"
                >
                  <option value="all">All Shortbook Items (Consolidated Purchase List)</option>
                  {distributors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.phone ? `(${d.phone})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Formatted Order Message Preview
                </label>
                <textarea
                  readOnly
                  rows={9}
                  value={generatedWhatsAppOrderText}
                  className="w-full p-2.5 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-950 font-mono text-[11px] leading-relaxed resize-none text-slate-800 dark:text-slate-200"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-navy-800">
                <button
                  type="button"
                  onClick={() => setShowWhatsAppModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-navy-700 text-slate-600 dark:text-slate-300"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={copyWhatsAppToClipboard}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-navy-600 bg-white dark:bg-navy-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Text</span>
                </button>
                <button
                  type="button"
                  onClick={openWhatsAppUrl}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send via WhatsApp</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------------------- */}
      {/* MODAL 7: STOCK ADJUSTMENT (PHYSICAL COUNT AUDIT) */}
      {/* ---------------------------------------------------------------------- */}
      {showAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-lg bg-white dark:bg-navy-900 shadow-xl border border-slate-200 dark:border-navy-700 p-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-navy-800">
              <h3 className="font-bold text-sm text-navy-900 dark:text-slate-100">
                Record Stock Adjustment
              </h3>
              <button onClick={() => setShowAdjustModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4 stroke-[2]" />
              </button>
            </div>

            <form onSubmit={handleAdjustSubmit} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Medicine Batch *
                </label>
                <select
                  value={adjustBatchId}
                  onChange={(e) => setAdjustBatchId(e.target.value)}
                  required
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800 font-mono"
                >
                  <option value="">Select batch...</option>
                  {allActiveBatches.map((b) => (
                    <option key={b.batchId} value={b.batchId}>
                      {b.medicineName} · Batch {b.batchNo} (Available: {b.stockBase} {b.baseUnit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Adjustment Type *
                </label>
                <select
                  value={adjustType}
                  onChange={(e: any) => setAdjustType(e.target.value)}
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800"
                >
                  <option value="adjustment">Physical Count Variance (+/-)</option>
                  <option value="damage">Damage / Breakage (-)</option>
                  <option value="expiry_writeoff">Expiry Write-Off (-)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Quantity in Base Units (e.g. Tablets) *
                </label>
                <input
                  type="number"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                  required
                  placeholder="e.g. 10"
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Reason / Audit Note
                </label>
                <input
                  type="text"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g. Shelf physical audit discrepancy"
                  className="w-full h-8 px-2 rounded border border-slate-200 dark:border-navy-700 bg-slate-50 dark:bg-navy-800"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-navy-800 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-3 py-1.5 rounded border border-slate-200 dark:border-navy-700 text-slate-600 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdjust}
                  className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white font-semibold disabled:opacity-50"
                >
                  Post Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
