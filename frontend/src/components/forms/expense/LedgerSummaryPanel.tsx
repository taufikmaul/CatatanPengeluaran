import React, { useEffect, useState } from "react";
import { Control, UseFormRegister, UseFormSetValue, useWatch } from "react-hook-form";
import { ExpenseFormData, ItemSuggestion } from "@/types";
import { CategoryFormProfile } from "@/lib/categoryFormConfig";
import { formatRupiah } from "@/lib/formatters";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarClock, Package, ShoppingBag, Calculator } from "lucide-react";
import { InlineMathInput } from "./InlineMathInput";
import { PriceSpikeAlert } from "./PriceSpikeAlert";

interface LedgerSummaryPanelProps {
  control: Control<ExpenseFormData>;
  register: UseFormRegister<ExpenseFormData>;
  setValue: UseFormSetValue<ExpenseFormData>;
  catProfile: CategoryFormProfile;
  units: string[];
  paymentMethods: string[];
  selectedSuggestionHint: ItemSuggestion | null;
  itemSuggestions: ItemSuggestion[];
  upsertNoteTag: (tagPrefix: string, val: string) => void;
}

export const LedgerSummaryPanel: React.FC<LedgerSummaryPanelProps> = React.memo(({
  control,
  register,
  setValue,
  catProfile,
  units,
  paymentMethods,
  selectedSuggestionHint,
  itemSuggestions,
  upsertNoteTag,
}) => {
  const [showNewTurunan, setShowNewTurunan] = useState(false);
  const [customTurunan, setCustomTurunan] = useState("");

  // Isolated watcher: hanya komponen ini yang re-render saat angka kalkulasi berubah
  const [
    qty = 1,
    unit = "Pcs",
    unitPrice = 0,
    shippingFee = 0,
    tax = 0,
    otherFee = 0,
    discount = 0,
    payStatus = "Lunas",
    itemName = "",
    notes = "",
  ] = useWatch({
    control,
    name: [
      "qty",
      "unit",
      "unit_price",
      "shipping_fee",
      "tax",
      "other_fee",
      "discount",
      "pay_status",
      "item_name",
      "notes",
    ],
  });

  const isOngkir = catProfile.archetype === "ongkir";
  const isTukarCash = catProfile.archetype === "tukar_cash";
  const isUnpaid =
    (payStatus || "").toLowerCase().includes("belum") ||
    (payStatus || "").toLowerCase().includes("hutang");

  const baseSubtotal = Math.max(0, Number(qty || 0) * Number(unitPrice || 0));
  const extraFeesTotal =
    Number(shippingFee || 0) + Number(tax || 0) + Number(otherFee || 0);
  const calculatedTotal = Math.max(
    0,
    baseSubtotal + extraFeesTotal - Number(discount || 0)
  );

  // Sinkronkan total_price ke form state hanya saat hasil kalkulasi berubah
  useEffect(() => {
    setValue("total_price", calculatedTotal, { shouldDirty: false });
  }, [calculatedTotal, setValue]);

  // Cari referensi harga terakhir untuk deteksi Price Spike / Typo
  const matchedReference = React.useMemo(() => {
    if (selectedSuggestionHint && selectedSuggestionHint.last_unit_price > 0) {
      return selectedSuggestionHint;
    }
    const q = (itemName || "").trim().toLowerCase();
    if (!q) return null;
    return (
      itemSuggestions.find(
        (s) => s.item_name.toLowerCase() === q && s.last_unit_price > 0
      ) || null
    );
  }, [selectedSuggestionHint, itemName, itemSuggestions]);

  return (
    <div className="lg:col-span-5 rounded-2xl border border-slate-200/90 bg-slate-50/70 p-4 sm:p-5 space-y-4 lg:sticky lg:top-0">
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-2.5">
        <span className="text-xs font-bold text-slate-800">
          Rincian Nominal & Pembayaran
        </span>
        <span className="text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200/70 px-2 py-0.5 rounded-md flex items-center gap-1">
          <Calculator className="w-3 h-3" />
          <span>Bisa ketik rumus (12*15k)</span>
        </span>
      </div>

      {/* Qty, Satuan, & Harga Satuan (Adaptif sesuai Kategori) */}
      {catProfile.hideQty ? (
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">
            {catProfile.priceLabel}
          </label>
          <InlineMathInput
            value={Number(unitPrice || 0)}
            onChange={(val) => {
              setValue("qty", 1);
              setValue("unit_price", val, { shouldValidate: true, shouldDirty: true });
            }}
            className="h-11 sm:h-10 text-sm rounded-xl bg-white font-bold tabular-nums"
            placeholder="Ketik nominal atau rumus (mis: 250k + 50k)"
          />
          <PriceSpikeAlert
            currentPrice={Number(unitPrice || 0)}
            referencePrice={matchedReference?.last_unit_price}
            itemName={matchedReference?.item_name}
            onApplyReferencePrice={(refPrice) =>
              setValue("unit_price", refPrice, { shouldValidate: true, shouldDirty: true })
            }
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-12 gap-2.5">
            <div className="col-span-1 sm:col-span-3">
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {isOngkir ? "Jml Trip" : "Qty"}
              </label>
              <InlineMathInput
                value={Number(qty || 0)}
                formatCurrencyHint={false}
                onChange={(val) =>
                  setValue("qty", val > 0 ? val : 1, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                className="h-11 sm:h-10 text-xs rounded-xl bg-white font-bold text-center tabular-nums"
                placeholder="1"
              />
            </div>

            <div className="col-span-1 sm:col-span-4">
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Satuan
              </label>
              {catProfile.lockUnit ? (
                <div className="h-11 sm:h-10 w-full rounded-xl border border-input bg-slate-100 px-3 text-xs font-semibold flex items-center text-slate-700">
                  {catProfile.defaultUnit}
                </div>
              ) : (
                <select
                  {...register("unit", { required: true })}
                  className="h-11 sm:h-10 w-full rounded-xl border border-input bg-white px-2.5 text-xs font-semibold focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {(catProfile.allowedUnits
                    ? units
                        .filter((u) => catProfile.allowedUnits!.includes(u))
                        .concat(units.filter((u) => !catProfile.allowedUnits!.includes(u)))
                    : units
                  ).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="col-span-2 sm:col-span-5">
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                {catProfile.priceLabel}
              </label>
              <InlineMathInput
                value={Number(unitPrice || 0)}
                onChange={(val) =>
                  setValue("unit_price", val, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                className="h-11 sm:h-10 text-xs rounded-xl bg-white font-bold tabular-nums"
                placeholder="Mis: 25000 atau 300k/12"
              />
            </div>
          </div>

          {/* Peringatan Lonjakan Harga / Salah Ketik Nol */}
          <PriceSpikeAlert
            currentPrice={Number(unitPrice || 0)}
            referencePrice={matchedReference?.last_unit_price}
            itemName={matchedReference?.item_name}
            onApplyReferencePrice={(refPrice) =>
              setValue("unit_price", refPrice, { shouldValidate: true, shouldDirty: true })
            }
          />
        </div>
      )}

      {/* Hint & Selector Satuan & Turunan dari Master Item */}
      {catProfile.showMasterItemAutocomplete &&
        selectedSuggestionHint &&
        (selectedSuggestionHint.isi_paket ||
          selectedSuggestionHint.tipe_satuan === "keduanya") && (
          <div className="p-3 bg-blue-50/80 border border-blue-200/80 rounded-xl text-xs space-y-2">
            <div className="flex items-center justify-between text-[11px] text-blue-800 font-semibold">
              <span className="flex items-center gap-1">
                <Package className="w-3.5 h-3.5 text-blue-600" />
                <span>Kemasan Master Item:</span>
              </span>
              {selectedSuggestionHint.isi_paket && (
                <span className="font-medium text-blue-700">
                  1 {selectedSuggestionHint.satuan_beli || "Box"}:{" "}
                  {selectedSuggestionHint.isi_paket}
                </span>
              )}
            </div>

            {selectedSuggestionHint.tipe_satuan === "keduanya" && (
              <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                <button
                  type="button"
                  onClick={() =>
                    setValue("unit", selectedSuggestionHint.satuan_beli || "Box")
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                    (unit || "").toLowerCase() ===
                    (selectedSuggestionHint.satuan_beli || "Box").toLowerCase()
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <Package className="w-3 h-3" />
                  <span>Paket ({selectedSuggestionHint.satuan_beli || "Box"})</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setValue("unit", selectedSuggestionHint.satuan_ecer || "Pouch")
                  }
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1 ${
                    (unit || "").toLowerCase() ===
                    (selectedSuggestionHint.satuan_ecer || "Pouch").toLowerCase()
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <ShoppingBag className="w-3 h-3" />
                  <span>Ecer ({selectedSuggestionHint.satuan_ecer || "Pouch"})</span>
                </button>
              </div>
            )}

            {(() => {
              const rawVariants = selectedSuggestionHint.isi_paket
                ? selectedSuggestionHint.isi_paket
                    .split(/[,;]\s*/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [];
              return (
                <div className="pt-1 border-t border-blue-200/50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-blue-900 font-medium">
                      Varian Isi / Turunan:
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewTurunan((prev) => !prev)}
                      className="text-[10px] text-blue-700 hover:underline font-medium"
                    >
                      {showNewTurunan ? "Tutup" : "+ Turunan Baru"}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {rawVariants.map((variant, idx) => {
                      const cleanVar = variant.replace(/^isi[:\s]*/i, "").trim();
                      const curNotes = notes || "";
                      const isPicked = curNotes
                        .toLowerCase()
                        .includes(cleanVar.toLowerCase());
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setValue(
                              "unit",
                              selectedSuggestionHint.satuan_beli || "Bungkus"
                            );
                            upsertNoteTag("Isi", cleanVar);
                          }}
                          className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 ${
                            isPicked
                              ? "bg-emerald-600 text-white shadow-xs"
                              : "bg-white text-slate-700 border border-blue-200 hover:bg-blue-100/50"
                          }`}
                        >
                          <span>
                            {selectedSuggestionHint.satuan_beli || "Bungkus"} (isi{" "}
                            {cleanVar})
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {showNewTurunan && (
                    <div className="flex items-center gap-1.5 pt-1">
                      <Input
                        placeholder="Contoh: 500g, 1Kg, 250ml"
                        value={customTurunan}
                        onChange={(e) => setCustomTurunan(e.target.value)}
                        className="h-8 text-xs bg-white rounded-lg flex-1"
                      />
                      <button
                        type="button"
                        disabled={!customTurunan.trim()}
                        onClick={() => {
                          const cleanVar = customTurunan.trim();
                          setValue(
                            "unit",
                            selectedSuggestionHint.satuan_beli || "Bungkus"
                          );
                          upsertNoteTag("Isi", cleanVar);
                          setCustomTurunan("");
                          setShowNewTurunan(false);
                        }}
                        className="h-8 px-2.5 bg-blue-600 text-white rounded-lg text-[11px] font-semibold hover:bg-blue-700 disabled:opacity-50"
                      >
                        Terapkan
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

      {/* Komponen Biaya Tambahan / Potongan */}
      {(catProfile.shippingFeeLabel ||
        catProfile.taxLabel ||
        catProfile.otherFeeLabel ||
        catProfile.discountLabel) && (
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          {catProfile.shippingFeeLabel && (
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                {catProfile.shippingFeeLabel}
              </label>
              <InlineMathInput
                value={Number(shippingFee || 0)}
                onChange={(val) => setValue("shipping_fee", val)}
                className="h-10 sm:h-9 text-xs rounded-xl bg-white tabular-nums"
                placeholder="0"
              />
            </div>
          )}

          {catProfile.taxLabel && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-slate-600">
                  {catProfile.taxLabel}
                </label>
                {Number(unitPrice) > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setValue(
                        "tax",
                        Math.round(Number(qty) * Number(unitPrice) * 0.11)
                      )
                    }
                    className="text-[10px] text-blue-600 hover:underline font-semibold"
                  >
                    +11% PPN
                  </button>
                )}
              </div>
              <InlineMathInput
                value={Number(tax || 0)}
                onChange={(val) => setValue("tax", val)}
                className="h-10 sm:h-9 text-xs rounded-xl bg-white tabular-nums"
                placeholder="0"
              />
            </div>
          )}

          {catProfile.otherFeeLabel && (
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                {catProfile.otherFeeLabel}
              </label>
              <InlineMathInput
                value={Number(otherFee || 0)}
                onChange={(val) => setValue("other_fee", val)}
                className="h-10 sm:h-9 text-xs rounded-xl bg-white tabular-nums"
                placeholder="0"
              />
            </div>
          )}

          {catProfile.discountLabel && (
            <div>
              <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                {catProfile.discountLabel}
              </label>
              <InlineMathInput
                value={Number(discount || 0)}
                onChange={(val) => setValue("discount", val)}
                className="h-10 sm:h-9 text-xs rounded-xl bg-white tabular-nums"
                placeholder="0"
              />
            </div>
          )}
        </div>
      )}

      {/* Calculated Total Highlight Box with Breakdown */}
      <div className="p-3.5 bg-white border border-blue-200/90 rounded-2xl space-y-2 shadow-2xs">
        {(extraFeesTotal > 0 || Number(discount) > 0) && (
          <div className="space-y-1 text-[11px] text-slate-500 border-b border-slate-100 pb-2">
            <div className="flex justify-between">
              <span>
                Subtotal ({qty} {unit})
              </span>
              <span className="font-mono tabular-nums">
                {formatRupiah(baseSubtotal)}
              </span>
            </div>
            {extraFeesTotal > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Biaya Tambahan / Pajak</span>
                <span className="font-mono tabular-nums">
                  +{formatRupiah(extraFeesTotal)}
                </span>
              </div>
            )}
            {Number(discount) > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span>Potongan / Diskon</span>
                <span className="font-mono tabular-nums">
                  -{formatRupiah(Number(discount))}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-slate-800">
            {catProfile.totalLabel}
          </span>
          <span className="text-lg font-extrabold text-blue-700 tabular-nums">
            {formatRupiah(calculatedTotal)}
          </span>
        </div>
      </div>

      {/* Metode Bayar & Status Pembayaran */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">
            Metode Bayar
          </label>
          {isTukarCash ? (
            <div className="h-11 sm:h-10 w-full rounded-xl border border-input bg-slate-100 px-3 text-xs font-semibold flex items-center justify-between text-slate-800">
              <span>Tunai (Otomatis)</span>
              <Badge
                variant="outline"
                className="text-[10px] bg-white text-emerald-700 border-emerald-200"
              >
                Kas Fisik
              </Badge>
            </div>
          ) : isOngkir ? (
            <>
              <Input
                list="ongkir-pay-methods"
                placeholder="Gopay, Ovo, Tunai, QRIS..."
                {...register("pay_method")}
                className="h-11 sm:h-10 text-xs rounded-xl bg-white"
              />
              <datalist id="ongkir-pay-methods">
                <option value="Gopay - Kasir" />
                <option value="Gopay - Owner" />
                <option value="Gopay - Maya" />
                <option value="Ovo - Akun" />
                <option value="Tunai" />
                <option value="QRIS" />
                <option value="Transfer" />
                <option value="COD" />
              </datalist>
            </>
          ) : (
            <select
              {...register("pay_method", {
                onChange: (e) => {
                  const val = e.target.value;
                  if (val === "COD") {
                    setValue("pay_status", "Belum Lunas");
                  } else {
                    setValue("pay_status", "Lunas");
                  }
                },
              })}
              className="h-11 sm:h-10 w-full rounded-xl border border-input bg-white px-3 text-xs font-semibold"
            >
              {paymentMethods.map((pm) => (
                <option key={pm} value={pm}>
                  {pm}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">
            Status Pembayaran
          </label>
          <select
            {...register("pay_status")}
            className="h-11 sm:h-10 w-full rounded-xl border border-input bg-white px-3 text-xs font-semibold"
          >
            <option value="Lunas">Lunas</option>
            <option value="Belum Lunas">Belum Lunas (Hutang)</option>
          </select>
        </div>
      </div>

      {/* Jatuh Tempo (Tampil menonjol saat Belum Lunas) */}
      {isUnpaid && (
        <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-2xl">
          <label className="text-xs font-semibold text-rose-800 flex items-center gap-1.5 mb-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-rose-600" />
            Tanggal Jatuh Tempo Tagihan
          </label>
          <Input
            type="date"
            {...register("due_date")}
            className="h-10 text-xs rounded-xl bg-white border-rose-200"
          />
        </div>
      )}
    </div>
  );
});

LedgerSummaryPanel.displayName = "LedgerSummaryPanel";

interface IsolatedStickyFooterProps {
  control: Control<ExpenseFormData>;
  catProfile: CategoryFormProfile;
  isSubmitting: boolean;
  isEditing: boolean;
  onClose: () => void;
}

export const IsolatedStickyFooter: React.FC<IsolatedStickyFooterProps> = React.memo(({
  control,
  catProfile,
  isSubmitting,
  isEditing,
  onClose,
}) => {
  const totalPrice = useWatch({ control, name: "total_price" }) || 0;

  return (
    <div className="px-4 sm:px-6 py-3 border-t border-slate-200/80 bg-slate-50/90 shrink-0 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="text-[10px] font-semibold text-slate-500 block truncate">
          {catProfile.totalLabel}
        </span>
        <span className="text-sm sm:text-base font-extrabold text-slate-900 tabular-nums">
          {formatRupiah(Number(totalPrice))}
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
            ? "Menyimpan..."
            : isEditing
            ? "Simpan Perubahan"
            : "Tambah Catatan"}
        </Button>
      </div>
    </div>
  );
});

IsolatedStickyFooter.displayName = "IsolatedStickyFooter";
