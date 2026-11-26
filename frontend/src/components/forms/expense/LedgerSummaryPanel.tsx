import React, { useEffect, useState, useMemo } from "react";
import { Control, UseFormRegister, UseFormSetValue, useWatch } from "react-hook-form";
import { BankAccount, ExpenseFormData, ItemSuggestion } from "@/types";
import { CategoryFormProfile } from "@/lib/categoryFormConfig";
import { formatRupiah, toIsoDate } from "@/lib/formatters";
import {
  computeLiveConversionPreview,
  formatConversionQty,
  shouldShowRetailTier,
} from "@/lib/packagingConversion";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { AdaptiveSelect } from "@/components/ui/searchable-select";
import { InlineMathInput } from "./InlineMathInput";
import { PriceSpikeAlert } from "./PriceSpikeAlert";
import {
  getTempoQuickDate,
  isDpStatus,
  isPaidStatus,
} from "@/lib/paymentStatus";

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
  bankAccounts?: BankAccount[];
}

export const LedgerSummaryPanel: React.FC<LedgerSummaryPanelProps> = React.memo(({
  control,
  setValue,
  catProfile,
  units,
  paymentMethods,
  selectedSuggestionHint,
  itemSuggestions,
  upsertNoteTag,
  bankAccounts = [],
}) => {
  const [showNewTurunan, setShowNewTurunan] = useState(false);
  const [customTurunan, setCustomTurunan] = useState("");
  const selectedBankAccountId = useWatch({ control, name: "bank_account_id" });

  const [
    qty = 1,
    unit = "Pcs",
    unitPrice = 0,
    shippingFee = 0,
    tax = 0,
    otherFee = 0,
    discount = 0,
    payMethod = "Transfer",
    payStatus = "Lunas",
    itemName = "",
    notes = "",
    dpType = "percent",
    dpPercent = 50,
    paidAmount = 0,
    dueDate = "-",
    expenseDate = "",
    dpPaymentDate = "",
    packagingId = null,
    reviewWarning = null,
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
      "pay_method",
      "pay_status",
      "item_name",
      "notes",
      "dp_type",
      "dp_percent",
      "paid_amount",
      "due_date",
      "expense_date",
      "dp_payment_date",
      "packaging_id",
      "review_warning",
    ],
  });

  const isOngkir = catProfile.archetype === "ongkir";
  const isTukarCash = catProfile.archetype === "tukar_cash";
  const isPaid = isPaidStatus(payStatus);
  const isDp = isDpStatus(payStatus);
  const isUnpaid = !isPaid;

  const baseSubtotal = Math.max(0, Number(qty || 0) * Number(unitPrice || 0));
  const extraFeesTotal =
    Number(shippingFee || 0) + Number(tax || 0) + Number(otherFee || 0);
  const calculatedTotal = Math.max(
    0,
    baseSubtotal + extraFeesTotal - Number(discount || 0)
  );

  useEffect(() => {
    setValue("total_price", calculatedTotal, { shouldDirty: false });
  }, [calculatedTotal, setValue]);

  useEffect(() => {
    if (!isDp) return;
    if ((dpType || "percent") === "percent" && calculatedTotal > 0) {
      const pct = Math.max(1, Math.min(99, Number(dpPercent || 50)));
      const computed = Math.round(calculatedTotal * (pct / 100));
      setValue("paid_amount", computed, { shouldDirty: false });
    }
  }, [isDp, dpType, dpPercent, calculatedTotal, setValue]);

  const effectiveDpAmount = isDp
    ? Math.min(calculatedTotal, Math.max(0, Number(paidAmount || 0)))
    : 0;
  const remainingAfterDp = Math.max(0, calculatedTotal - effectiveDpAmount);
  const effectiveDpPct =
    calculatedTotal > 0
      ? Math.round((effectiveDpAmount / calculatedTotal) * 1000) / 10
      : 0;

  const matchedReference = useMemo(() => {
    if (selectedSuggestionHint) {
      return selectedSuggestionHint;
    }
    const q = (itemName || "").trim().toLowerCase();
    if (!q) return null;
    return (
      itemSuggestions.find((s) => s.item_name.toLowerCase() === q) || null
    );
  }, [selectedSuggestionHint, itemName, itemSuggestions]);

  const activePackagings = useMemo(
    () => (matchedReference?.packagings || []).filter((p) => p.is_active !== false),
    [matchedReference]
  );

  const selectedPackaging = useMemo(() => {
    if (activePackagings.length === 0) return null;
    if (packagingId) {
      const byId = activePackagings.find((p) => p.id === packagingId);
      if (byId) return byId;
    }
    const uLow = (unit || "").trim().toLowerCase();
    const byUnit = activePackagings.filter(
      (p) => p.purchase_unit.toLowerCase() === uLow
    );
    return byUnit.length === 1 ? byUnit[0] : null;
  }, [activePackagings, packagingId, unit]);

  const liveConversion = useMemo(
    () =>
      computeLiveConversionPreview({
        qty: Number(qty || 1),
        unit: unit || "Pcs",
        unitPrice: Number(unitPrice || 0),
        selectedPackaging,
        legacySatuanBeli: matchedReference?.satuan_beli,
        legacySatuanEcer: matchedReference?.satuan_ecer,
        legacySatuanResep: matchedReference?.satuan_resep,
        legacyKonversiResep: matchedReference?.konversi_resep,
      }),
    [qty, unit, unitPrice, selectedPackaging, matchedReference]
  );

  const orderedUnits = useMemo(() => {
    if (!catProfile.allowedUnits) return units;
    return units
      .filter((u) => catProfile.allowedUnits!.includes(u))
      .concat(units.filter((u) => !catProfile.allowedUnits!.includes(u)));
  }, [catProfile.allowedUnits, units]);

  const payMethodOptions = useMemo(() => {
    if (isOngkir) {
      return Array.from(
        new Set([
          "Gopay - Kasir",
          "Gopay - Owner",
          "Gopay - Maya",
          "Ovo - Akun",
          "Tunai",
          "QRIS",
          "Transfer",
          "COD",
          ...paymentMethods,
        ])
      );
    }
    return paymentMethods;
  }, [isOngkir, paymentMethods]);

  const bankAccountOptions = useMemo(() => {
    return [
      { value: "", label: "Otomatis (Sesuai Mapping Metode Bayar)" },
      ...bankAccounts.map((acc) => ({
        value: String(acc.id),
        label: `${acc.name} (${acc.account_code})`,
        sublabel: acc.bank_name,
      })),
    ];
  }, [bankAccounts]);

  return (
    <div className="lg:col-span-5 lg:pl-6 pt-4 lg:pt-0 border-t lg:border-t-0 border-border/70 space-y-4">
      <div className="flex items-center justify-between border-b border-border/70 pb-2">
        <span className="text-xs font-semibold text-foreground tracking-tight">
          Rincian Nominal &amp; Pembayaran
        </span>
        <span className="text-[11px] text-muted-foreground">
          Mendukung rumus (12*15k)
        </span>
      </div>

      {/* Qty, Satuan, & Harga Satuan */}
      {catProfile.hideQty ? (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground block">
            {catProfile.priceLabel}
          </label>
          <InlineMathInput
            value={Number(unitPrice || 0)}
            onChange={(val) => {
              setValue("qty", 1);
              setValue("unit_price", val, { shouldValidate: true, shouldDirty: true });
            }}
            inputClassName="font-semibold"
            placeholder="0 atau rumus (250k + 50k)"
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
          <div className="grid grid-cols-12 gap-2.5">
            <div className="col-span-4 sm:col-span-3 space-y-1">
              <label className="text-xs font-medium text-foreground block">
                {isOngkir ? "Trip" : "Qty"}
              </label>
              <InlineMathInput
                value={Number(qty || 0)}
                formatCurrencyHint={false}
                prefixText=""
                onChange={(val) =>
                  setValue("qty", val > 0 ? val : 1, {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                inputClassName="font-semibold text-center"
                placeholder="1"
              />
            </div>

            <div className="col-span-8 sm:col-span-4 space-y-1">
              <label className="text-xs font-medium text-foreground block">
                Satuan
              </label>
              {catProfile.lockUnit ? (
                <div className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-xs font-medium flex items-center text-muted-foreground">
                  {catProfile.defaultUnit}
                </div>
              ) : (
                <AdaptiveSelect
                  value={unit || "Pcs"}
                  onValueChange={(val) => {
                    setValue("unit", val || "Pcs", {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                    setValue("packaging_id", null);
                  }}
                  options={orderedUnits}
                  placeholder="Pilih satuan..."
                  searchPlaceholder="Cari satuan..."
                  creatable={true}
                  creatablePrefix="Satuan"
                />
              )}
            </div>

            <div className="col-span-12 sm:col-span-5 space-y-1">
              <label className="text-xs font-medium text-foreground block">
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
                inputClassName="font-semibold"
                placeholder="25000 atau 300k/12"
              />
            </div>
          </div>

          <PriceSpikeAlert
            currentPrice={Number(unitPrice || 0)}
            referencePrice={
              selectedPackaging?.last_unit_price ?? matchedReference?.last_unit_price
            }
            itemName={matchedReference?.item_name}
            onApplyReferencePrice={(refPrice) =>
              setValue("unit_price", refPrice, { shouldValidate: true, shouldDirty: true })
            }
          />

          {reviewWarning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700/80 dark:bg-amber-950/40 px-2.5 py-2 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <span>{reviewWarning}</span>
            </div>
          )}

          {activePackagings.length > 0 && (
            <div className="pt-2 border-t border-border/70 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">Varian Kemasan</span>
                <span>Pilih kemasan sesuai nota</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activePackagings.map((pkg) => {
                  const isSelected = selectedPackaging?.id === pkg.id;
                  return (
                    <button
                      key={pkg.id || pkg.label}
                      type="button"
                      onClick={() => {
                        setValue("packaging_id", pkg.id ?? null);
                        setValue("unit", pkg.purchase_unit, {
                          shouldValidate: true,
                          shouldDirty: true,
                        });
                        setValue("review_status", "CONFIRMED");
                        setValue("review_warning", null);
                        if (
                          pkg.last_unit_price &&
                          pkg.last_unit_price > 0 &&
                          Number(unitPrice || 0) === 0
                        ) {
                          setValue("unit_price", pkg.last_unit_price, {
                            shouldValidate: true,
                            shouldDirty: true,
                          });
                        }
                      }}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors text-left ${
                        isSelected
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background text-foreground border-input hover:bg-muted/60"
                      }`}
                    >
                      <span>{pkg.label}</span>
                      <span className="ml-1 opacity-75">
                        ({formatConversionQty(pkg.base_qty)} {pkg.base_unit})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {liveConversion.base_qty !== null && liveConversion.base_unit && (
            <div className="rounded-md border border-emerald-200/80 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/30 px-2.5 py-1.5 text-[11px] text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap font-medium">
                <span>
                  {formatConversionQty(Number(qty || 1))} {unit || "Pcs"}
                </span>
                {shouldShowRetailTier({
                  qty: Number(qty || 1),
                  unit: unit || "Pcs",
                  retailQty: liveConversion.retail_qty,
                  retailUnit: liveConversion.retail_unit,
                  baseUnit: liveConversion.base_unit,
                }) && (
                  <>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span>
                      {formatConversionQty(liveConversion.retail_qty)}{" "}
                      {liveConversion.retail_unit}
                    </span>
                  </>
                )}
                <ArrowRight className="w-3 h-3 shrink-0" />
                <strong className="tabular-nums">
                  {formatConversionQty(liveConversion.base_qty)}{" "}
                  {liveConversion.base_unit}
                </strong>
              </div>
              {liveConversion.base_unit_price !== null && (
                <span className="tabular-nums font-semibold">
                  {formatRupiah(liveConversion.base_unit_price)}/{liveConversion.base_unit}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hint & Selector Satuan & Turunan Legacy (hanya jika belum pakai Varian Kemasan) */}
      {activePackagings.length === 0 &&
        catProfile.showMasterItemAutocomplete &&
        selectedSuggestionHint &&
        (selectedSuggestionHint.isi_paket ||
          selectedSuggestionHint.tipe_satuan === "keduanya") && (
          <div className="pt-2.5 border-t border-border/70 text-xs space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Kemasan Master Item</span>
              {selectedSuggestionHint.isi_paket && (
                <span>
                  1 {selectedSuggestionHint.satuan_beli || "Box"}: {selectedSuggestionHint.isi_paket}
                </span>
              )}
            </div>

            {selectedSuggestionHint.tipe_satuan === "keduanya" && (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setValue("unit", selectedSuggestionHint.satuan_beli || "Box")
                  }
                  className={`h-8 px-2.5 rounded-md text-xs font-medium border transition-colors ${
                    (unit || "").toLowerCase() ===
                    (selectedSuggestionHint.satuan_beli || "Box").toLowerCase()
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-foreground border-input hover:bg-muted/50"
                  }`}
                >
                  Paket ({selectedSuggestionHint.satuan_beli || "Box"})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setValue("unit", selectedSuggestionHint.satuan_ecer || "Pouch")
                  }
                  className={`h-8 px-2.5 rounded-md text-xs font-medium border transition-colors ${
                    (unit || "").toLowerCase() ===
                    (selectedSuggestionHint.satuan_ecer || "Pouch").toLowerCase()
                      ? "bg-foreground text-background border-foreground"
                      : "bg-background text-foreground border-input hover:bg-muted/50"
                  }`}
                >
                  Ecer ({selectedSuggestionHint.satuan_ecer || "Pouch"})
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
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      Varian Isi / Turunan
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewTurunan((prev) => !prev)}
                      className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-medium"
                    >
                      {showNewTurunan ? "Tutup" : "+ Turunan Baru"}
                    </button>
                  </div>

                  {rawVariants.length > 0 && (
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
                            className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                              isPicked
                                ? "bg-foreground text-background border-foreground"
                                : "bg-background text-foreground border-input hover:bg-muted/60"
                            }`}
                          >
                            {selectedSuggestionHint.satuan_beli || "Bungkus"} ({cleanVar})
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {showNewTurunan && (
                    <InputGroup className="h-8">
                      <InputGroupInput
                        placeholder="Contoh: 500g, 1Kg, 250ml"
                        value={customTurunan}
                        onChange={(e) => setCustomTurunan(e.target.value)}
                        className="text-xs"
                      />
                      <InputGroupAddon align="inline-end" className="pr-1">
                        <InputGroupButton
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
                          className="font-semibold text-blue-600 dark:text-blue-400"
                        >
                          Terapkan
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
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
        <div className="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-border/70">
          {catProfile.shippingFeeLabel && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                {catProfile.shippingFeeLabel.replace(/\s*\(Rp\)/i, "")}
              </label>
              <InlineMathInput
                value={Number(shippingFee || 0)}
                onChange={(val) => setValue("shipping_fee", val)}
                placeholder="0"
              />
            </div>
          )}

          {catProfile.taxLabel && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                {catProfile.taxLabel.replace(/\s*\(Rp\)/i, "")}
              </label>
              <InlineMathInput
                value={Number(tax || 0)}
                onChange={(val) => setValue("tax", val)}
                placeholder="0"
                suffixAddon={
                  Number(unitPrice) > 0 ? (
                    <InputGroupButton
                      size="xs"
                      onClick={() =>
                        setValue(
                          "tax",
                          Math.round(Number(qty) * Number(unitPrice) * 0.11)
                        )
                      }
                      className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 h-6 px-1.5"
                    >
                      +11%
                    </InputGroupButton>
                  ) : undefined
                }
              />
            </div>
          )}

          {catProfile.otherFeeLabel && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                {catProfile.otherFeeLabel.replace(/\s*\(Rp\)/i, "")}
              </label>
              <InlineMathInput
                value={Number(otherFee || 0)}
                onChange={(val) => setValue("other_fee", val)}
                placeholder="0"
              />
            </div>
          )}

          {catProfile.discountLabel && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                {catProfile.discountLabel.replace(/\s*\(Rp\)/i, "")}
              </label>
              <InlineMathInput
                value={Number(discount || 0)}
                onChange={(val) => setValue("discount", val)}
                placeholder="0"
              />
            </div>
          )}
        </div>
      )}

      {/* Editorial Total Summary Line (Zero Nested Card) */}
      <div className="pt-3 pb-1 border-t border-border/80 space-y-1.5">
        {(extraFeesTotal > 0 || Number(discount) > 0) && (
          <div className="space-y-1 text-[11px] text-muted-foreground pb-1.5 border-b border-border/50">
            <div className="flex justify-between">
              <span>
                Subtotal ({qty} {unit})
              </span>
              <span className="font-mono tabular-nums">
                {formatRupiah(baseSubtotal)}
              </span>
            </div>
            {extraFeesTotal > 0 && (
              <div className="flex justify-between">
                <span>Biaya Tambahan / Pajak</span>
                <span className="font-mono tabular-nums">
                  +{formatRupiah(extraFeesTotal)}
                </span>
              </div>
            )}
            {Number(discount) > 0 && (
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>Potongan / Diskon</span>
                <span className="font-mono tabular-nums">
                  -{formatRupiah(Number(discount))}
                </span>
              </div>
            )}
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">
            {catProfile.totalLabel}
          </span>
          <span className="text-lg font-bold tracking-tight text-foreground tabular-nums">
            {formatRupiah(calculatedTotal)}
          </span>
        </div>
      </div>

      {/* Metode Bayar & Status Pembayaran */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2.5 border-t border-border/70">
        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground block">
            Metode Bayar
          </label>
          {isTukarCash ? (
            <div className="h-9 w-full rounded-md border border-input bg-muted/40 px-3 text-xs font-medium flex items-center justify-between text-foreground">
              <span>Tunai (Otomatis)</span>
              <Badge variant="outline" className="text-[10px]">
                Kas Fisik
              </Badge>
            </div>
          ) : (
            <AdaptiveSelect
              value={payMethod || "Transfer"}
              onValueChange={(val) => {
                setValue("pay_method", val, { shouldDirty: true });
                if (val === "COD") {
                  setValue("pay_status", "Belum Lunas");
                } else if (!isDp) {
                  setValue("pay_status", "Lunas");
                }
              }}
              options={payMethodOptions}
              creatable={isOngkir}
              creatablePrefix="Metode"
              placeholder="Pilih metode bayar..."
              searchPlaceholder="Cari metode bayar..."
            />
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground block">
            Status Pembayaran
          </label>
          <AdaptiveSelect
            value={payStatus || "Lunas"}
            onValueChange={(nextStatus) => {
              setValue("pay_status", nextStatus, { shouldDirty: true });
              if (isDpStatus(nextStatus)) {
                if (!dpType) setValue("dp_type", "percent");
                if (!dpPercent) setValue("dp_percent", 50);
                if (!dueDate || dueDate === "-") {
                  setValue("due_date", getTempoQuickDate(14, expenseDate));
                }
              } else if (nextStatus === "Belum Lunas") {
                setValue("paid_amount", 0);
                if (!dueDate || dueDate === "-") {
                  setValue("due_date", getTempoQuickDate(7, expenseDate));
                }
              }
            }}
            options={[
              { value: "Lunas", label: "Lunas" },
              { value: "DP / Sebagian", label: "DP / Bayar Sebagian" },
              { value: "Belum Lunas", label: "Belum Lunas (Hutang)" },
            ]}
          />
        </div>
      </div>

      {/* Skema DP (Flat Hairline Section, Zero Nested Card & Zero Quick Preset Buttons) */}
      {isDp && (
        <div className="pt-3 border-t border-border/70 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-foreground">
              Rincian DP (Uang Muka)
            </span>
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
              {effectiveDpPct}% dibayar awal
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                Skema Perhitungan DP
              </label>
              <AdaptiveSelect
                value={dpType || "percent"}
                onValueChange={(val) => {
                  setValue("dp_type", val as "percent" | "amount");
                  if (val === "percent" && !dpPercent) setValue("dp_percent", 50);
                }}
                options={[
                  { value: "percent", label: "Persentase (%)" },
                  { value: "amount", label: "Nominal (Rp)" },
                ]}
              />
            </div>

            {(dpType || "percent") === "percent" ? (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground block">
                  Persentase DP
                </label>
                <InputGroup className="h-9">
                  <InputGroupInput
                    type="number"
                    min={1}
                    max={99}
                    value={Number(dpPercent || 50)}
                    onChange={(e) => setValue("dp_percent", Number(e.target.value))}
                    aria-label="Persentase DP"
                    className="text-xs font-semibold tabular-nums"
                  />
                  <InputGroupAddon align="inline-end" className="pr-2.5">
                    <InputGroupText className="text-xs">%</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground block">
                  Nominal DP Dibayar Sekarang
                </label>
                <InlineMathInput
                  value={Number(paidAmount || 0)}
                  onChange={(val) => {
                    setValue("paid_amount", val, { shouldDirty: true });
                    if (calculatedTotal > 0) {
                      setValue(
                        "dp_percent",
                        Math.round((val / calculatedTotal) * 10000) / 100
                      );
                    }
                  }}
                  inputClassName="font-semibold"
                  placeholder="Contoh: 500k"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs py-1.5 border-y border-border/50">
            <div>
              <span className="text-[11px] text-muted-foreground mr-1.5">DP Dibayar:</span>
              <span className="font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
                {formatRupiah(effectiveDpAmount)}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground mr-1.5">Sisa:</span>
              <span className="font-semibold text-rose-700 dark:text-rose-400 tabular-nums">
                {formatRupiah(remainingAfterDp)}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground block">
              Tanggal Bayar DP
            </label>
            <DatePicker
              value={dpPaymentDate || expenseDate || ""}
              onChange={(d) => setValue("dp_payment_date", toIsoDate(d))}
              className="w-full h-9 text-xs"
            />
          </div>
        </div>
      )}

      {/* Rekening Sumber (Kas / Bank / Petty Cash) */}
      {bankAccounts.length > 0 && (isPaid || isDp) && (
        <div className="space-y-1 pt-2.5 border-t border-border/70">
          <label className="text-xs font-medium text-foreground block">
            {isDp ? "Rekening Sumber Pembayaran DP" : "Rekening Sumber Dana"}
          </label>
          <AdaptiveSelect
            value={selectedBankAccountId ? String(selectedBankAccountId) : ""}
            onValueChange={(val) =>
              setValue("bank_account_id", val ? Number(val) : null)
            }
            options={bankAccountOptions}
            placeholder="Otomatis (Sesuai Mapping Metode Bayar)"
            searchPlaceholder="Cari rekening..."
          />
        </div>
      )}

      {/* Jatuh Tempo (Flat Hairline Section, Zero Preset Buttons) */}
      {isUnpaid && (
        <div className="pt-2.5 border-t border-border/70 space-y-1">
          <label className="text-xs font-medium text-rose-700 dark:text-rose-400 block">
            {isDp ? "Tanggal Jatuh Tempo Pelunasan Sisa" : "Tanggal Jatuh Tempo Tagihan"}
          </label>
          <DatePicker
            value={dueDate === "-" ? "" : dueDate || ""}
            onChange={(d) => setValue("due_date", toIsoDate(d), { shouldDirty: true })}
            className="w-full h-9 text-xs"
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
  const [totalPrice = 0, payStatus = "Lunas", paidAmount = 0] = useWatch({
    control,
    name: ["total_price", "pay_status", "paid_amount"],
  });
  const isDp = isDpStatus(payStatus);
  const dpPaid = isDp ? Math.min(Number(totalPrice), Math.max(0, Number(paidAmount))) : 0;
  const dpRemaining = Math.max(0, Number(totalPrice) - dpPaid);

  return (
    <div className="px-4 sm:px-6 py-3 border-t border-border/80 bg-background shrink-0 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="text-[11px] font-medium text-muted-foreground block truncate">
          {isDp ? "Total Invoice (DP & Sisa)" : catProfile.totalLabel}
        </span>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm sm:text-base font-bold text-foreground tabular-nums">
            {formatRupiah(Number(totalPrice))}
          </span>
          {isDp && (
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
              (DP {formatRupiah(dpPaid)} / Sisa {formatRupiah(dpRemaining)})
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          className="h-9 px-4 text-xs font-medium"
        >
          Batal
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
          className="h-9 px-5 text-xs font-semibold"
        >
          {isSubmitting
            ? "Menyimpan..."
            : isEditing
            ? "Simpan Perubahan"
            : "Simpan Transaksi"}
        </Button>
      </div>
    </div>
  );
});

IsolatedStickyFooter.displayName = "IsolatedStickyFooter";
