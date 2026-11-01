import React, { useState, useMemo, useEffect } from "react";
import {
  ExpenseFormData,
  ExpenseUser,
  ItemSuggestion,
  OcrExtractedItem,
} from "@/types";
import { getCategoryFormProfile } from "@/lib/categoryFormConfig";
import { formatRupiah } from "@/lib/formatters";
import { checkInvoiceDuplicate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Copy,
  Store,
  Check,
  AlertTriangle,
  Briefcase,
  CalendarClock,
  Calculator,
  Layers,
} from "lucide-react";
import { InlineMathInput } from "./InlineMathInput";
import { PriceSpikeAlert } from "./PriceSpikeAlert";

export interface MultiExpenseRow {
  rowId: string;
  category: string;
  item_name: string;
  qty: number;
  unit: string;
  unit_price: number;
  notes: string;
  master_item_id: number | null;
  reference_price?: number | null;
}

interface ExpenseMultiItemFormProps {
  categories: string[];
  defaultCategory?: string;
  units: string[];
  paymentMethods: string[];
  itemSuggestions: ItemSuggestion[];
  supplierSuggestions: string[];
  usersList: ExpenseUser[];
  isSubmitting: boolean;
  ocrSeedItems?: OcrExtractedItem[];
  onBatchSubmit: (items: ExpenseFormData[]) => void;
  onClose: () => void;
}

const createEmptyRow = (category: string): MultiExpenseRow => {
  const prof = getCategoryFormProfile(category);
  return {
    rowId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    category,
    item_name: "",
    qty: 1,
    unit: prof.defaultUnit || "Pcs",
    unit_price: 0,
    notes: "",
    master_item_id: null,
    reference_price: null,
  };
};

export const ExpenseMultiItemForm: React.FC<ExpenseMultiItemFormProps> = ({
  categories,
  defaultCategory,
  units,
  paymentMethods,
  itemSuggestions,
  supplierSuggestions,
  usersList,
  isSubmitting,
  ocrSeedItems,
  onBatchSubmit,
  onClose,
}) => {
  const initialCat =
    (defaultCategory && categories.includes(defaultCategory)
      ? defaultCategory
      : "") ||
    categories[0] ||
    "Bahan Kue";

  // Header Nota Bersama
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [supplier, setSupplier] = useState("-");
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("-");
  const [invoiceWarning, setInvoiceWarning] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState("Transfer");
  const [payStatus, setPayStatus] = useState("Lunas");
  const [dueDate, setDueDate] = useState("-");
  const [isReimbursement, setIsReimbursement] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [msgLink, setMsgLink] = useState("Web Dashboard");

  // Biaya Nota Gabungan
  const [shippingFee, setShippingFee] = useState(0);
  const [tax, setTax] = useState(0);
  const [otherFee, setOtherFee] = useState(0);
  const [discount, setDiscount] = useState(0);

  // Daftar Baris Item Belanja
  const [rows, setRows] = useState<MultiExpenseRow[]>(() => [
    createEmptyRow(initialCat),
    createEmptyRow(initialCat),
  ]);
  const [activeAutocompleteRow, setActiveAutocompleteRow] = useState<
    string | null
  >(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Jika ada hasil OCR multi-item yang dikirim ke tab ini, muat otomatis
  useEffect(() => {
    if (ocrSeedItems && ocrSeedItems.length > 0) {
      const first = ocrSeedItems[0];
      if (first.tanggal) setExpenseDate(first.tanggal);
      if (first.toko_supplier && first.toko_supplier !== "-") {
        setSupplier(first.toko_supplier);
      }
      if (first.no_invoice && first.no_invoice !== "-") {
        setInvoiceNumber(first.no_invoice);
      }
      if (first.metode_bayar && paymentMethods.includes(first.metode_bayar)) {
        setPayMethod(first.metode_bayar);
      }
      setShippingFee(Number(first.ongkir ?? first.shipping_fee ?? 0));
      setTax(Number(first.tax ?? 0));
      setOtherFee(Number(first.biaya_lainnya ?? first.other_fee ?? 0));
      setDiscount(Number(first.diskon ?? 0));

      setRows(
        ocrSeedItems.map((it, idx) => {
          const cat =
            it.kategori && categories.includes(it.kategori)
              ? it.kategori
              : initialCat;
          const prof = getCategoryFormProfile(cat);
          const q = Number(it.qty) > 0 ? Number(it.qty) : 1;
          const up = Number(it.harga_satuan) > 0
            ? Number(it.harga_satuan)
            : Number(it.total_harga) > 0
            ? Math.round(Number(it.total_harga) / q)
            : 0;
          return {
            rowId: `ocr-${idx}-${Date.now()}`,
            category: cat,
            item_name: it.barang || "",
            qty: q,
            unit: it.satuan || it.unit || prof.defaultUnit || "Pcs",
            unit_price: up,
            notes: it.keterangan && it.keterangan !== "-" ? it.keterangan : "",
            master_item_id: null,
            reference_price: null,
          };
        })
      );
    }
  }, [ocrSeedItems, categories, initialCat, paymentMethods]);

  const handleCheckInvoice = async (inv: string) => {
    if (!inv || inv.trim() === "-" || inv.trim().length < 3) {
      setInvoiceWarning(null);
      return;
    }
    try {
      const res = await checkInvoiceDuplicate(inv);
      if (res.is_duplicate && res.message) {
        setInvoiceWarning(res.message);
      } else {
        setInvoiceWarning(null);
      }
    } catch {
      setInvoiceWarning(null);
    }
  };

  const filteredSupplierSuggestions = useMemo(() => {
    const q = supplier.trim().toLowerCase();
    if (!q || q === "-") return supplierSuggestions.slice(0, 8);
    return supplierSuggestions
      .filter((s) => s.toLowerCase().includes(q))
      .slice(0, 8);
  }, [supplier, supplierSuggestions]);

  const updateRow = (rowId: string, patch: Partial<MultiExpenseRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r))
    );
    setFormError(null);
  };

  const handleAddRow = (cat?: string) => {
    const fallbackCat = cat || rows[rows.length - 1]?.category || initialCat;
    setRows((prev) => [...prev, createEmptyRow(fallbackCat)]);
  };

  const handleDuplicateRow = (row: MultiExpenseRow) => {
    setRows((prev) => [
      ...prev,
      {
        ...row,
        rowId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      },
    ]);
  };

  const handleRemoveRow = (rowId: string) => {
    if (rows.length <= 1) {
      setRows([createEmptyRow(initialCat)]);
      return;
    }
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const handleSelectSuggestion = (rowId: string, s: ItemSuggestion) => {
    const nextCat =
      s.category && categories.includes(s.category) ? s.category : undefined;
    updateRow(rowId, {
      item_name: s.item_name,
      ...(nextCat ? { category: nextCat } : {}),
      unit: s.satuan_beli || "Pcs",
      unit_price: s.last_unit_price > 0 ? s.last_unit_price : 0,
      master_item_id: s.is_master && s.id ? s.id : null,
      reference_price: s.last_unit_price > 0 ? s.last_unit_price : null,
    });
    if (
      s.last_supplier &&
      s.last_supplier !== "-" &&
      (!supplier || supplier === "-")
    ) {
      setSupplier(s.last_supplier);
    }
    setActiveAutocompleteRow(null);
  };

  // Ringkasan kalkulasi seluruh baris
  const itemsSubtotal = useMemo(
    () =>
      rows.reduce(
        (acc, r) => acc + Math.max(0, Number(r.qty || 0) * Number(r.unit_price || 0)),
        0
      ),
    [rows]
  );

  const extraFeesTotal =
    Number(shippingFee || 0) + Number(tax || 0) + Number(otherFee || 0);
  const grandTotal = Math.max(
    0,
    itemsSubtotal + extraFeesTotal - Number(discount || 0)
  );

  // Ringkasan alokasi per kategori di dalam nota ini
  const categoryBreakdown = useMemo(() => {
    const map: Record<string, { count: number; subtotal: number }> = {};
    for (const r of rows) {
      if (!r.item_name.trim()) continue;
      const sub = Math.max(0, Number(r.qty || 0) * Number(r.unit_price || 0));
      if (!map[r.category]) {
        map[r.category] = { count: 0, subtotal: 0 };
      }
      map[r.category].count += 1;
      map[r.category].subtotal += sub;
    }
    return Object.entries(map);
  }, [rows]);

  const isUnpaid =
    payStatus.toLowerCase().includes("belum") ||
    payStatus.toLowerCase().includes("hutang");

  const handleSubmitMulti = (e: React.FormEvent) => {
    e.preventDefault();
    const validRows = rows.filter((r) => r.item_name.trim().length > 0);
    if (validRows.length === 0) {
      setFormError("Harap isi minimal 1 nama barang/keperluan pada daftar nota.");
      return;
    }

    const batchPayload: ExpenseFormData[] = validRows.map((r, idx) => {
      const prof = getCategoryFormProfile(r.category);
      const q = prof.hideQty ? 1 : Number(r.qty) > 0 ? Number(r.qty) : 1;
      const up = Number(r.unit_price) || 0;
      // Alokasikan ongkir/pajak/biaya lain/diskon nota pada baris pertama agar total laporan tidak ganda
      const rowShip = idx === 0 ? Number(shippingFee || 0) : 0;
      const rowTax = idx === 0 ? Number(tax || 0) : 0;
      const rowOther = idx === 0 ? Number(otherFee || 0) : 0;
      const rowDisc = idx === 0 ? Number(discount || 0) : 0;
      const rowTotal = Math.max(
        0,
        q * up + rowShip + rowTax + rowOther - rowDisc
      );

      return {
        expense_date: expenseDate,
        supplier: supplier.trim() || "-",
        item_name: r.item_name.trim(),
        qty: q,
        unit: r.unit || prof.defaultUnit || "Pcs",
        category: r.category,
        unit_price: up,
        shipping_fee: rowShip,
        tax: rowTax,
        other_fee: rowOther,
        discount: rowDisc,
        total_price: rowTotal,
        pay_method: payMethod,
        pay_status: payStatus,
        due_date: isUnpaid && dueDate ? dueDate : "-",
        notes: r.notes.trim() || "-",
        invoice_number: invoiceNumber.trim() || "-",
        is_reimbursement: isReimbursement,
        msg_link: msgLink.trim() || "Web Dashboard",
        user_id: userId,
        master_item_id: r.master_item_id,
      };
    });

    onBatchSubmit(batchPayload);
    onClose();
  };

  return (
    <form
      onSubmit={handleSubmitMulti}
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Header Informasi Nota Gabungan */}
        <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50/80 border border-slate-200/90 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-bold text-slate-800">
                Informasi Nota Gabungan (Berlaku untuk Semua Baris di Bawah)
              </span>
            </div>
            <span className="text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200/70 px-2 py-0.5 rounded-md flex items-center gap-1">
              <Calculator className="w-3 h-3" />
              <span>Kolom Qty & Harga mendukung rumus (mis: 12*15k)</span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-3">
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                Tanggal Nota
              </label>
              <Input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                required
                className="h-10 text-xs rounded-xl bg-white"
              />
            </div>

            <div className="lg:col-span-4 relative">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-slate-700">
                  Toko / Supplier Nota
                </label>
                {supplier && supplier !== "-" && (
                  <button
                    type="button"
                    onClick={() => setSupplier("-")}
                    className="text-[10px] text-slate-400 hover:text-slate-600"
                  >
                    Reset (-)
                  </button>
                )}
              </div>
              <Input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                onFocus={() => setShowSupplierDropdown(true)}
                onBlur={() => setTimeout(() => setShowSupplierDropdown(false), 180)}
                placeholder="Mis: Superindo, Toko Wahab, Titan..."
                className="h-10 text-xs rounded-xl bg-white"
              />
              {showSupplierDropdown && filteredSupplierSuggestions.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-44 overflow-y-auto divide-y divide-slate-100">
                  {filteredSupplierSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSupplier(s);
                        setShowSupplierDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between"
                    >
                      <span className="font-medium text-slate-800">{s}</span>
                      <Check className="w-3.5 h-3.5 text-blue-600" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-3">
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                No. Invoice / Struk
              </label>
              <Input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                onBlur={(e) => handleCheckInvoice(e.target.value)}
                placeholder="INV-2026/... atau -"
                className="h-10 text-xs rounded-xl bg-white font-mono"
              />
            </div>

            <div className="lg:col-span-2">
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                Tipe Dana
              </label>
              <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-input bg-white hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isReimbursement}
                  onChange={(e) => setIsReimbursement(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-slate-300"
                />
                <span className="text-xs font-semibold text-slate-700 truncate">
                  Talangan
                </span>
              </label>
            </div>
          </div>

          {invoiceWarning && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>{invoiceWarning}</span>
            </div>
          )}
        </div>

        {/* Tabel Daftar Barang Multi-Item & Multi-Kategori */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-800">
                Daftar Barang & Kategori dalam Nota Ini
              </span>
              <Badge variant="outline" className="text-[11px] font-semibold">
                {rows.length} Baris
              </Badge>
              {categoryBreakdown.map(([cat, info]) => (
                <span
                  key={cat}
                  className="text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/80 px-2 py-0.5 rounded-lg tabular-nums"
                >
                  {cat} ({info.count}): {formatRupiah(info.subtotal)}
                </span>
              ))}
            </div>

            <Button
              type="button"
              size="sm"
              onClick={() => handleAddRow()}
              className="h-9 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Baris Barang</span>
            </Button>
          </div>

          {formError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
              {formError}
            </div>
          )}

          <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-200/80 bg-white">
            {rows.map((row, idx) => {
              const rowProfile = getCategoryFormProfile(row.category);
              const rowSubtotal = Math.max(
                0,
                Number(row.qty || 0) * Number(row.unit_price || 0)
              );

              // Filter saran barang dengan prioritas kategori baris ini
              const q = row.item_name.trim().toLowerCase();
              const catLower = row.category.toLowerCase();
              const rowSuggestions =
                activeAutocompleteRow === row.rowId
                  ? [...itemSuggestions]
                      .sort((a, b) => {
                        const aMatch =
                          (a.category || "").toLowerCase() === catLower ? 1 : 0;
                        const bMatch =
                          (b.category || "").toLowerCase() === catLower ? 1 : 0;
                        return bMatch - aMatch;
                      })
                      .filter(
                        (s) =>
                          !q ||
                          s.item_name.toLowerCase().includes(q) ||
                          (s.aliases && s.aliases.toLowerCase().includes(q))
                      )
                      .slice(0, 6)
                  : [];

              // Cari harga referensi untuk deteksi anomali harga pada baris ini
              const matchedItemRef =
                row.reference_price ||
                itemSuggestions.find(
                  (s) =>
                    s.item_name.toLowerCase() === q && s.last_unit_price > 0
                )?.last_unit_price ||
                null;

              return (
                <div
                  key={row.rowId}
                  className="p-3.5 space-y-2.5 hover:bg-slate-50/50 transition-colors"
                >
                  <div className="grid grid-cols-12 gap-2.5 items-start">
                    {/* Nomor & Pemilih Kategori Baris */}
                    <div className="col-span-12 sm:col-span-4 lg:col-span-3 flex items-center gap-2">
                      <span className="w-5 text-center text-xs font-mono font-bold text-slate-400 shrink-0">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <select
                          value={row.category}
                          onChange={(e) => {
                            const nextCat = e.target.value;
                            const nextProf = getCategoryFormProfile(nextCat);
                            updateRow(row.rowId, {
                              category: nextCat,
                              unit: nextProf.defaultUnit || row.unit,
                              qty: nextProf.hideQty ? 1 : row.qty,
                            });
                          }}
                          className="w-full h-10 px-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl font-semibold text-slate-800 focus:ring-2 focus:ring-blue-500"
                        >
                          {categories.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <span className="text-[10px] font-mono text-slate-500 block mt-0.5 pl-1 truncate">
                          {rowProfile.badgeLabel} ({rowProfile.coaLabel})
                        </span>
                      </div>
                    </div>

                    {/* Nama Barang / Deskripsi */}
                    <div className="col-span-12 sm:col-span-8 lg:col-span-4 relative">
                      <Input
                        value={row.item_name}
                        onChange={(e) => {
                          updateRow(row.rowId, { item_name: e.target.value });
                          setActiveAutocompleteRow(row.rowId);
                        }}
                        onFocus={() => setActiveAutocompleteRow(row.rowId)}
                        onBlur={() =>
                          setTimeout(() => setActiveAutocompleteRow(null), 180)
                        }
                        placeholder={rowProfile.itemPlaceholder}
                        className="h-10 text-xs rounded-xl font-medium"
                      />

                      {/* Autocomplete Master Item per Baris */}
                      {activeAutocompleteRow === row.rowId &&
                        rowProfile.showMasterItemAutocomplete &&
                        rowSuggestions.length > 0 && (
                          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-52 overflow-y-auto divide-y divide-slate-100">
                            {rowSuggestions.map((s) => (
                              <button
                                key={`${s.item_name}-${s.is_master}`}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleSelectSuggestion(row.rowId, s);
                                }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-800 truncate">
                                    {s.item_name}
                                  </p>
                                  <p className="text-[10px] text-slate-500">
                                    {s.category} • {s.satuan_beli || "Pcs"}
                                  </p>
                                </div>
                                {s.last_unit_price > 0 && (
                                  <span className="text-[11px] font-bold text-blue-700 tabular-nums shrink-0">
                                    {formatRupiah(s.last_unit_price)}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}

                      {/* Quick Chips jika nama barang masih kosong */}
                      {!row.item_name &&
                        rowProfile.quickItemChips &&
                        rowProfile.quickItemChips.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {rowProfile.quickItemChips.slice(0, 4).map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                onClick={() =>
                                  updateRow(row.rowId, { item_name: chip })
                                }
                                className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-600 transition-colors"
                              >
                                + {chip}
                              </button>
                            ))}
                          </div>
                        )}
                    </div>

                    {/* Qty & Satuan */}
                    <div className="col-span-5 sm:col-span-3 lg:col-span-1">
                      <InlineMathInput
                        value={row.qty}
                        formatCurrencyHint={false}
                        disabled={rowProfile.hideQty}
                        onChange={(val) =>
                          updateRow(row.rowId, { qty: val > 0 ? val : 1 })
                        }
                        className="h-10 text-xs rounded-xl text-center font-bold tabular-nums"
                        placeholder="Qty"
                      />
                    </div>

                    <div className="col-span-7 sm:col-span-3 lg:col-span-1">
                      <select
                        value={row.unit}
                        disabled={rowProfile.lockUnit}
                        onChange={(e) =>
                          updateRow(row.rowId, { unit: e.target.value })
                        }
                        className="w-full h-10 px-2 text-xs bg-white border border-slate-300 rounded-xl font-semibold"
                      >
                        {(rowProfile.allowedUnits || units).map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Harga Satuan (Rumus Inline) */}
                    <div className="col-span-8 sm:col-span-4 lg:col-span-2">
                      <InlineMathInput
                        value={row.unit_price}
                        onChange={(val) =>
                          updateRow(row.rowId, { unit_price: val })
                        }
                        placeholder="Harga / rumus"
                        className="h-10 text-xs rounded-xl font-bold tabular-nums"
                      />
                    </div>

                    {/* Subtotal Baris & Aksi */}
                    <div className="col-span-4 sm:col-span-2 lg:col-span-1 flex items-center justify-end gap-1 h-10">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Duplikat baris ini"
                        onClick={() => handleDuplicateRow(row)}
                        className="h-9 w-8 p-0 text-slate-400 hover:text-blue-600 rounded-lg"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Hapus baris"
                        onClick={() => handleRemoveRow(row.rowId)}
                        className="h-9 w-8 p-0 text-slate-400 hover:text-rose-600 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Deteksi Anomali Harga Spesifik Baris */}
                  <PriceSpikeAlert
                    currentPrice={row.unit_price}
                    referencePrice={matchedItemRef}
                    itemName={row.item_name}
                    onApplyReferencePrice={(refPrice) =>
                      updateRow(row.rowId, { unit_price: refPrice })
                    }
                  />

                  {/* Baris Bawah: Catatan per Item + Subtotal Baris */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:pl-7">
                    <Input
                      value={row.notes}
                      onChange={(e) =>
                        updateRow(row.rowId, { notes: e.target.value })
                      }
                      placeholder={
                        rowProfile.notesPlaceholder ||
                        "Keterangan baris ini (opsional)..."
                      }
                      className="h-8 text-[11px] rounded-xl bg-slate-50/70 border-slate-200 text-slate-600 flex-1"
                    />
                    <div className="flex items-center justify-end gap-1.5 text-xs shrink-0">
                      <span className="text-slate-400">Subtotal baris:</span>
                      <span className="font-bold text-slate-800 tabular-nums">
                        {formatRupiah(rowSubtotal)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Shortcut Tambah Baris dengan Kategori Berbeda */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500">
                + Tambah baris kategori lain:
              </span>
              {[
                "Bahan Kue",
                "Bahan Minuman",
                "Kemasan",
                "Kebersihan",
                "Operasional",
                "Kantor",
              ]
                .filter((c) => categories.includes(c))
                .map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => handleAddRow(c)}
                    className="px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 border border-slate-200/80 transition-colors"
                  >
                    + {c}
                  </button>
                ))}
            </div>
          </div>
        </div>

        {/* Panel Bawah: Biaya Tambahan Nota & Metode Pembayaran */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 rounded-2xl bg-slate-50/80 border border-slate-200/90">
          <div className="lg:col-span-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                Ongkir Nota (Rp)
              </label>
              <InlineMathInput
                value={shippingFee}
                onChange={setShippingFee}
                placeholder="0"
                className="h-9 text-xs rounded-xl bg-white tabular-nums"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-slate-600">
                  Pajak PPN
                </label>
                {itemsSubtotal > 0 && (
                  <button
                    type="button"
                    onClick={() => setTax(Math.round(itemsSubtotal * 0.11))}
                    className="text-[10px] text-blue-600 hover:underline font-semibold"
                  >
                    +11%
                  </button>
                )}
              </div>
              <InlineMathInput
                value={tax}
                onChange={setTax}
                placeholder="0"
                className="h-9 text-xs rounded-xl bg-white tabular-nums"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                Biaya Lain
              </label>
              <InlineMathInput
                value={otherFee}
                onChange={setOtherFee}
                placeholder="0"
                className="h-9 text-xs rounded-xl bg-white tabular-nums"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                Diskon Nota
              </label>
              <InlineMathInput
                value={discount}
                onChange={setDiscount}
                placeholder="0"
                className="h-9 text-xs rounded-xl bg-white tabular-nums"
              />
            </div>
          </div>

          <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div>
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                Metode Bayar
              </label>
              <select
                value={payMethod}
                onChange={(e) => {
                  const val = e.target.value;
                  setPayMethod(val);
                  if (val === "COD") setPayStatus("Belum Lunas");
                }}
                className="h-9 w-full rounded-xl border border-input bg-white px-2.5 text-xs font-semibold"
              >
                {paymentMethods.map((pm) => (
                  <option key={pm} value={pm}>
                    {pm}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                Status Pembayaran
              </label>
              <select
                value={payStatus}
                onChange={(e) => setPayStatus(e.target.value)}
                className="h-9 w-full rounded-xl border border-input bg-white px-2.5 text-xs font-semibold"
              >
                <option value="Lunas">Lunas</option>
                <option value="Belum Lunas">Belum Lunas (Hutang)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                Penginput (User)
              </label>
              <select
                value={userId ?? ""}
                onChange={(e) =>
                  setUserId(e.target.value ? Number(e.target.value) : null)
                }
                className="h-9 w-full rounded-xl border border-input bg-white px-2.5 text-xs"
              >
                <option value="">Otomatis (Web Dashboard)</option>
                {usersList.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isUnpaid && (
            <div className="lg:col-span-12 p-3 bg-rose-50/80 border border-rose-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-semibold text-rose-800 flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-rose-600" />
                Tanggal Jatuh Tempo Nota Ini
              </label>
              <Input
                type="date"
                value={dueDate === "-" ? "" : dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required={isUnpaid}
                className="h-9 text-xs rounded-xl bg-white border-rose-200 sm:w-56"
              />
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="px-4 sm:px-6 py-3 border-t border-slate-200/80 bg-slate-50/90 shrink-0 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold text-slate-500 block truncate">
            Total Gabungan ({rows.filter((r) => r.item_name.trim()).length} Barang di Nota Ini)
          </span>
          <span className="text-sm sm:text-base font-extrabold text-blue-700 tabular-nums">
            {formatRupiah(grandTotal)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="rounded-xl text-xs h-11 sm:h-10 px-4 font-semibold"
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs h-11 sm:h-10 px-5 font-semibold shadow-xs"
          >
            {isSubmitting
              ? "Menyimpan Nota..."
              : `Simpan Semua (${rows.filter((r) => r.item_name.trim()).length || rows.length} Item)`}
          </Button>
        </div>
      </div>
    </form>
  );
};
