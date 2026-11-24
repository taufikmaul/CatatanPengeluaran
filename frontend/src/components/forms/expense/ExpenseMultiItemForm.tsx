import React, { useState, useMemo, useEffect } from "react";
import {
  ExpenseFormData,
  ExpenseUser,
  ItemSuggestion,
  OcrExtractedItem,
} from "@/types";
import { getCategoryFormProfile } from "@/lib/categoryFormConfig";
import { formatRupiah, toIsoDate } from "@/lib/formatters";
import { checkInvoiceDuplicate } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { InputGroupButton } from "@/components/ui/input-group";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import {
  Plus,
  Trash2,
  Copy,
  AlertTriangle,
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

  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [supplier, setSupplier] = useState("-");
  const [invoiceNumber, setInvoiceNumber] = useState("-");
  const [invoiceWarning, setInvoiceWarning] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState("Transfer");
  const [payStatus, setPayStatus] = useState("Lunas");
  const [dueDate, setDueDate] = useState("-");
  const [isReimbursement, setIsReimbursement] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [msgLink] = useState("Web Dashboard");

  const [shippingFee, setShippingFee] = useState(0);
  const [tax, setTax] = useState(0);
  const [otherFee, setOtherFee] = useState(0);
  const [discount, setDiscount] = useState(0);

  const [rows, setRows] = useState<MultiExpenseRow[]>(() => [
    createEmptyRow(initialCat),
    createEmptyRow(initialCat),
  ]);
  const [activeAutocompleteRow, setActiveAutocompleteRow] = useState<
    string | null
  >(null);
  const [formError, setFormError] = useState<string | null>(null);

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
          const up =
            Number(it.harga_satuan) > 0
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

  const supplierOptions = useMemo(() => {
    return supplierSuggestions
      .filter((s) => s && s !== "-")
      .map((s) => ({ value: s, label: s }));
  }, [supplierSuggestions]);

  const userSelectOptions = useMemo(() => {
    return [
      { value: "", label: "Otomatis (Web Dashboard)" },
      ...usersList.map((u) => ({
        value: String(u.id),
        label: u.name,
        sublabel: u.telegram_id ? `@${u.telegram_id}` : undefined,
      })),
    ];
  }, [usersList]);

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

  const itemsSubtotal = useMemo(
    () =>
      rows.reduce(
        (acc, r) =>
          acc + Math.max(0, Number(r.qty || 0) * Number(r.unit_price || 0)),
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
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-5">
        {/* Header Informasi Nota Gabungan (Zero Nested Card) */}
        <div className="space-y-3 pb-4 border-b border-border/70">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold text-foreground tracking-tight">
              Informasi Nota Gabungan
            </span>
            <span className="text-[11px] text-muted-foreground">
              Kolom Qty &amp; Harga mendukung rumus (12*15k)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
            <div className="lg:col-span-3 space-y-1">
              <label className="text-xs font-medium text-foreground block">
                Tanggal Nota
              </label>
              <DatePicker
                value={expenseDate}
                onChange={(d) => setExpenseDate(toIsoDate(d))}
                className="w-full h-9 text-xs"
              />
            </div>

            <div className="lg:col-span-4 space-y-1">
              <label className="text-xs font-medium text-foreground block">
                Toko / Supplier Nota
              </label>
              <AdaptiveSelect
                value={supplier === "-" ? "" : supplier}
                onValueChange={(val) => setSupplier(val || "-")}
                options={supplierOptions}
                searchable={true}
                creatable={true}
                creatablePrefix="Gunakan"
                allowClear={true}
                clearValue="-"
                placeholder="Pilih atau ketik toko/supplier..."
                searchPlaceholder="Cari atau ketik supplier..."
              />
            </div>

            <div className="lg:col-span-3 space-y-1">
              <label className="text-xs font-medium text-foreground block">
                No. Invoice / Struk
              </label>
              <Input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                onBlur={(e) => handleCheckInvoice(e.target.value)}
                placeholder="INV-2026/... atau -"
                className="h-9 text-xs font-mono"
              />
            </div>

            <div className="lg:col-span-2 space-y-1">
              <label className="text-xs font-medium text-foreground block">
                Tipe Dana
              </label>
              <label className="flex items-center gap-2 h-9 px-3 rounded-md border border-input bg-background hover:bg-muted/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isReimbursement}
                  onChange={(e) => setIsReimbursement(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-input"
                />
                <span className="text-xs font-medium text-foreground truncate">
                  Talangan
                </span>
              </label>
            </div>
          </div>

          {invoiceWarning && (
            <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{invoiceWarning}</span>
            </div>
          )}
        </div>

        {/* Daftar Barang Multi-Item (Flat Hairline Ledger Rows) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-foreground">
                Daftar Barang &amp; Kategori
              </span>
              <Badge variant="outline" className="text-[11px] font-medium">
                {rows.length} Baris
              </Badge>
              {categoryBreakdown.map(([cat, info]) => (
                <span
                  key={cat}
                  className="text-[11px] text-muted-foreground tabular-nums"
                >
                  • {cat} ({info.count}): {formatRupiah(info.subtotal)}
                </span>
              ))}
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => handleAddRow()}
              className="h-8 px-3 text-xs font-medium gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Baris</span>
            </Button>
          </div>

          {formError && (
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {formError}
            </p>
          )}

          <div className="divide-y divide-border/70 border-y border-border/70">
            {rows.map((row, idx) => {
              const rowProfile = getCategoryFormProfile(row.category);
              const rowSubtotal = Math.max(
                0,
                Number(row.qty || 0) * Number(row.unit_price || 0)
              );

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
                  className="py-3 space-y-2"
                >
                  <div className="grid grid-cols-12 gap-2 items-start">
                    {/* Nomor & Pemilih Kategori Baris (Shadcn SearchableSelect) */}
                    <div className="col-span-12 sm:col-span-4 lg:col-span-3 flex items-center gap-2">
                      <span className="w-5 text-center text-xs font-mono text-muted-foreground shrink-0">
                        {idx + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <AdaptiveSelect
                          value={row.category}
                          onValueChange={(nextCat) => {
                            const nextProf = getCategoryFormProfile(nextCat);
                            updateRow(row.rowId, {
                              category: nextCat,
                              unit: nextProf.defaultUnit || row.unit,
                              qty: nextProf.hideQty ? 1 : row.qty,
                            });
                          }}
                          options={categories}
                          placeholder="Kategori..."
                          searchPlaceholder="Cari kategori..."
                        />
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
                        className="h-9 text-xs"
                      />

                      {activeAutocompleteRow === row.rowId &&
                        rowProfile.showMasterItemAutocomplete &&
                        rowSuggestions.length > 0 && (
                          <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-popover text-popover-foreground border border-border rounded-lg shadow-lg max-h-52 overflow-y-auto divide-y divide-border/50">
                            {rowSuggestions.map((s) => (
                              <button
                                key={`${s.item_name}-${s.is_master}`}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleSelectSuggestion(row.rowId, s);
                                }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-accent/60 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground truncate">
                                    {s.item_name}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {s.category} • {s.satuan_beli || "Pcs"}
                                  </p>
                                </div>
                                {s.last_unit_price > 0 && (
                                  <span className="text-[11px] font-semibold text-foreground tabular-nums shrink-0">
                                    {formatRupiah(s.last_unit_price)}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                    </div>

                    {/* Qty */}
                    <div className="col-span-4 sm:col-span-3 lg:col-span-1">
                      <InlineMathInput
                        value={row.qty}
                        formatCurrencyHint={false}
                        prefixText=""
                        disabled={rowProfile.hideQty}
                        onChange={(val) =>
                          updateRow(row.rowId, { qty: val > 0 ? val : 1 })
                        }
                        inputClassName="text-center font-semibold"
                        placeholder="Qty"
                      />
                    </div>

                    {/* Satuan (Shadcn AdaptiveSelect) */}
                    <div className="col-span-8 sm:col-span-3 lg:col-span-1">
                      <AdaptiveSelect
                        value={row.unit}
                        disabled={rowProfile.lockUnit}
                        onValueChange={(nextUnit) =>
                          updateRow(row.rowId, { unit: nextUnit })
                        }
                        options={rowProfile.allowedUnits || units}
                        placeholder="Satuan"
                        searchPlaceholder="Cari satuan..."
                        creatable={true}
                        creatablePrefix="Satuan"
                      />
                    </div>

                    {/* Harga Satuan */}
                    <div className="col-span-8 sm:col-span-4 lg:col-span-2">
                      <InlineMathInput
                        value={row.unit_price}
                        onChange={(val) =>
                          updateRow(row.rowId, { unit_price: val })
                        }
                        placeholder="Harga / rumus"
                        inputClassName="font-semibold"
                      />
                    </div>

                    {/* Aksi Baris */}
                    <div className="col-span-4 sm:col-span-2 lg:col-span-1 flex items-center justify-end gap-1 h-9">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Duplikat baris ini"
                        onClick={() => handleDuplicateRow(row)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Hapus baris"
                        onClick={() => handleRemoveRow(row.rowId)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

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
                      className="h-8 text-xs text-muted-foreground flex-1"
                    />
                    <div className="flex items-center justify-end gap-1.5 text-xs shrink-0">
                      <span className="text-muted-foreground">Subtotal:</span>
                      <span className="font-semibold text-foreground tabular-nums">
                        {formatRupiah(rowSubtotal)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel Bawah: Biaya Tambahan Nota & Metode Pembayaran (Flat Hairline Section) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
          <div className="lg:col-span-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                Ongkir Nota
              </label>
              <InlineMathInput
                value={shippingFee}
                onChange={setShippingFee}
                placeholder="0"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                Pajak PPN
              </label>
              <InlineMathInput
                value={tax}
                onChange={setTax}
                placeholder="0"
                suffixAddon={
                  itemsSubtotal > 0 ? (
                    <InputGroupButton
                      size="xs"
                      onClick={() => setTax(Math.round(itemsSubtotal * 0.11))}
                      className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 h-6 px-1.5"
                    >
                      +11%
                    </InputGroupButton>
                  ) : undefined
                }
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                Biaya Lain
              </label>
              <InlineMathInput
                value={otherFee}
                onChange={setOtherFee}
                placeholder="0"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                Diskon Nota
              </label>
              <InlineMathInput
                value={discount}
                onChange={setDiscount}
                placeholder="0"
              />
            </div>
          </div>

          <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-foreground block">
                Metode Bayar
              </label>
              <AdaptiveSelect
                value={payMethod}
                onValueChange={(val) => {
                  setPayMethod(val);
                  if (val === "COD") setPayStatus("Belum Lunas");
                }}
                options={paymentMethods}
                placeholder="Metode bayar..."
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-foreground block">
                Status Pembayaran
              </label>
              <AdaptiveSelect
                value={payStatus}
                onValueChange={setPayStatus}
                options={[
                  { value: "Lunas", label: "Lunas" },
                  { value: "Belum Lunas", label: "Belum Lunas (Hutang)" },
                ]}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-foreground block">
                Penginput (User)
              </label>
              <AdaptiveSelect
                value={userId ? String(userId) : ""}
                onValueChange={(val) =>
                  setUserId(val ? Number(val) : null)
                }
                options={userSelectOptions}
                placeholder="Otomatis (Web Dashboard)"
                searchPlaceholder="Cari penginput..."
              />
            </div>
          </div>

          {isUnpaid && (
            <div className="lg:col-span-12 pt-2 border-t border-border/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-medium text-rose-700 dark:text-rose-400">
                Tanggal Jatuh Tempo Nota Ini
              </label>
              <DatePicker
                value={dueDate === "-" ? "" : dueDate}
                onChange={(d) => setDueDate(toIsoDate(d))}
                className="w-full sm:w-56 h-9 text-xs"
              />
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="px-4 sm:px-6 py-3 border-t border-border/80 bg-background shrink-0 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[11px] font-medium text-muted-foreground block truncate">
            Total Gabungan ({rows.filter((r) => r.item_name.trim()).length} Barang)
          </span>
          <span className="text-sm sm:text-base font-bold text-foreground tabular-nums">
            {formatRupiah(grandTotal)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="h-9 text-xs px-4 font-medium"
          >
            Batal
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-9 text-xs px-5 font-semibold"
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
