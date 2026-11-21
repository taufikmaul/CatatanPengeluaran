import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSharedAnonymousMenus } from "@/lib/api";
import { formatRupiah } from "@/lib/formatters";
import { FoodCostStatus, MenuItemType } from "@/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Lock,
  Loader2,
  Search,
  TrendingUp,
} from "lucide-react";

interface SharedMenuReadOnlyPageProps {
  token: string;
}

function getBadgeStyle(status: FoodCostStatus): { label: string; className: string } {
  switch (status) {
    case "ideal":
      return {
        label: "Ideal",
        className:
          "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800",
      };
    case "moderate":
      return {
        label: "Sedang",
        className:
          "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800",
      };
    case "high":
      return {
        label: "Tinggi",
        className:
          "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800",
      };
    case "not_sellable":
      return {
        label: "Internal (Prepared)",
        className:
          "bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
      };
    case "no_price":
      return {
        label: "Belum Ada Harga",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
    default:
      return {
        label: "Belum Ada HPP",
        className:
          "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      };
  }
}

export const SharedMenuReadOnlyPage: React.FC<SharedMenuReadOnlyPageProps> = ({ token }) => {
  const [search, setSearch] = useState("");
  const [itemTypeFilter, setItemTypeFilter] = useState<"all" | MenuItemType>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [hppStatusFilter, setHppStatusFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["shared-menus", token, search, itemTypeFilter, categoryFilter, hppStatusFilter],
    queryFn: () =>
      getSharedAnonymousMenus(token, {
        search: search.trim() || undefined,
        item_type: itemTypeFilter !== "all" ? itemTypeFilter : undefined,
        category: categoryFilter !== "all" ? categoryFilter : undefined,
        hpp_status: hppStatusFilter !== "all" ? hppStatusFilter : undefined,
      }),
    enabled: !!token,
    retry: false,
  });

  const items = data?.items || [];
  const summary = data?.summary;
  const categories = data?.categories || [];

  const expiresLabel = useMemo(() => {
    if (!data?.expires_at) return null;
    try {
      return new Date(data.expires_at * 1000).toLocaleString("id-ID");
    } catch {
      return null;
    }
  }, [data?.expires_at]);

  const handleDownloadJson = () => {
    if (!data) return;
    const payload = {
      exported_at: new Date().toISOString(),
      anonymized: true,
      read_only: true,
      summary: data.summary,
      items: data.items,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "menu_hpp_anonim_readonly.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("JSON anonim berhasil diunduh.");
  };

  const handleCopyJson = async () => {
    if (!data) return;
    const payload = {
      exported_at: new Date().toISOString(),
      anonymized: true,
      read_only: true,
      summary: data.summary,
      items: data.items,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      toast.success("JSON anonim disalin ke clipboard.");
    } catch {
      toast.error("Gagal menyalin ke clipboard.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold">
                Katalog Menu &amp; Food Cost (Mode Anonim Read-Only)
              </h1>
              <Badge className="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 text-[11px] gap-1">
                <Lock className="w-3 h-3" />
                Terkunci Anonim
              </Badge>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Tampilan presentasi ter-anonim tanpa akses ubah data. Nama menu, SKU, dan nama bahan resep disamarkan.
              {expiresLabel ? ` Berlaku s/d ${expiresLabel}.` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyJson}
              disabled={!data || items.length === 0}
              className="min-h-[44px] sm:min-h-[36px] text-xs gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Salin JSON</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadJson}
              disabled={!data || items.length === 0}
              className="min-h-[44px] sm:min-h-[36px] text-xs gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON</span>
            </Button>
          </div>
        </div>

        {!token ? (
          <Card className="border-slate-200 dark:border-slate-800 shadow-none">
            <CardContent className="py-12 text-center space-y-2">
              <AlertCircle className="w-7 h-7 text-rose-600 mx-auto" />
              <p className="text-sm font-semibold">Token presentasi tidak ditemukan pada URL.</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Minta link presentasi anonim terbaru dari admin atau pemilik toko.
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <Card className="border-slate-200 dark:border-slate-800 shadow-none">
            <CardContent className="py-12 flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Memuat data menu anonim read-only...</span>
            </CardContent>
          </Card>
        ) : isError ? (
          <Card className="border-slate-200 dark:border-slate-800 shadow-none">
            <CardContent className="py-12 text-center space-y-3">
              <AlertCircle className="w-7 h-7 text-rose-600 mx-auto" />
              <p className="text-sm font-semibold">
                Link presentasi tidak valid atau sudah kedaluwarsa.
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Silakan minta link presentasi baru atau muat ulang halaman.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                Coba Lagi
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Card className="border-slate-200 dark:border-slate-800 shadow-none">
                <CardContent className="p-3.5">
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">Total Menu</div>
                  <div className="text-lg font-bold tabular-nums mt-0.5">
                    {summary?.total_menus ?? 0}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-slate-200 dark:border-slate-800 shadow-none">
                <CardContent className="p-3.5">
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    Rata-rata Food Cost
                  </div>
                  <div className="text-lg font-bold tabular-nums mt-0.5">
                    {summary && summary.avg_food_cost_pct > 0 ? `${summary.avg_food_cost_pct}%` : "-"}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-slate-200 dark:border-slate-800 shadow-none">
                <CardContent className="p-3.5">
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    Rata-rata Margin
                  </div>
                  <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums mt-0.5">
                    {summary && summary.avg_margin_pct > 0 ? `${summary.avg_margin_pct}%` : "-"}
                  </div>
                </CardContent>
              </Card>
              <Card className="border-slate-200 dark:border-slate-800 shadow-none">
                <CardContent className="p-3.5">
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    Food Cost Tinggi (&gt;45%)
                  </div>
                  <div className="text-lg font-bold text-rose-700 dark:text-rose-400 tabular-nums mt-0.5">
                    {summary?.high_count ?? 0}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Filters */}
            <Card className="border-slate-200 dark:border-slate-800 shadow-none">
              <CardContent className="p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari kode anonim atau kategori..."
                      className="pl-8 h-10 sm:h-9 text-xs"
                    />
                  </div>
                  <select
                    value={itemTypeFilter}
                    onChange={(e) =>
                      setItemTypeFilter(e.target.value as "all" | MenuItemType)
                    }
                    aria-label="Filter tipe menu"
                    className="h-10 sm:h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                  >
                    <option value="all">Semua Tipe Item</option>
                    <option value="finished">Menu Jual</option>
                    <option value="prepared">Prepared / Setengah Jadi</option>
                    <option value="bundle">Paket / Bundling</option>
                  </select>
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-10 sm:h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                  >
                    <option value="all">Semua Kategori</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <select
                    value={hppStatusFilter}
                    onChange={(e) => setHppStatusFilter(e.target.value)}
                    className="h-10 sm:h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                  >
                    <option value="all">Semua Status Food Cost</option>
                    <option value="ideal">Ideal (&le;35%)</option>
                    <option value="moderate">Sedang (35% - 45%)</option>
                    <option value="high">Tinggi (&gt;45%)</option>
                    <option value="not_sellable">Internal (Prepared)</option>
                    <option value="price_drift">Kenaikan Harga Bahan</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            {/* Table / Cards */}
            <Card className="border-slate-200 dark:border-slate-800 shadow-none overflow-hidden">
              {items.length === 0 ? (
                <div className="py-12 text-center space-y-2 px-4">
                  <BookOpen className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-semibold">Tidak ada data menu yang tampil.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                      <tr>
                        <th className="w-9 px-2 py-2.5" />
                        <th className="text-left px-3 py-2.5 font-semibold">Kode Anonim Menu</th>
                        <th className="text-left px-3 py-2.5 font-semibold">Kategori</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Harga Jual</th>
                        <th className="text-right px-3 py-2.5 font-semibold">HPP / Food Cost</th>
                        <th className="text-center px-3 py-2.5 font-semibold">Food Cost %</th>
                        <th className="text-right px-3 py-2.5 font-semibold">Margin Kotor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {items.map((menu) => {
                        const badge = getBadgeStyle(menu.food_cost_status);
                        const isExp = !!expandedIds[menu.id];
                        const hasExpand =
                          menu.ingredient_count > 0 ||
                          (menu.other_fee && menu.other_fee > 0) ||
                          (menu.labor_cost && menu.labor_cost > 0);
                        const ingRows = (menu.ingredients || []).filter(
                          (i) => i.cost_group !== "packaging"
                        );
                        const pkgRows = (menu.ingredients || []).filter(
                          (i) => i.cost_group === "packaging"
                        );

                        return (
                          <React.Fragment key={menu.id}>
                            <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                              <td className="px-2 py-2.5 text-center">
                                {hasExpand && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedIds((p) => ({ ...p, [menu.id]: !p[menu.id] }))
                                    }
                                    className="p-1 rounded hover:bg-slate-200/70 dark:hover:bg-slate-800"
                                    aria-label={`Lihat komposisi ${menu.anonymous_name}`}
                                  >
                                    {isExp ? (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-mono font-semibold">{menu.anonymous_name}</span>
                                  {menu.item_type === "prepared" && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] bg-amber-50 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800"
                                    >
                                      Prepared
                                    </Badge>
                                  )}
                                  {menu.item_type === "bundle" && (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-800"
                                    >
                                      Bundling
                                    </Badge>
                                  )}
                                </div>
                                {menu.has_price_drift && (
                                  <div className="inline-flex items-center gap-1 text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">
                                    <TrendingUp className="w-3 h-3" />
                                    <span>Bahan naik +{menu.max_ingredient_increase_pct}%</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-3 py-2.5">
                                <Badge variant="outline" className="text-[10px]">
                                  {menu.category}
                                </Badge>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums">
                                {!menu.is_sellable
                                  ? "Internal"
                                  : menu.selling_price > 0
                                  ? formatRupiah(menu.selling_price)
                                  : "-"}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                                {menu.effective_hpp > 0 ? formatRupiah(menu.effective_hpp) : "-"}
                              </td>
                              <td className="px-3 py-2.5 text-center">
                                <div className="inline-flex flex-col items-center gap-0.5">
                                  <span className="font-semibold tabular-nums">
                                    {menu.is_sellable && menu.selling_price > 0 && menu.effective_hpp > 0
                                      ? `${menu.food_cost_pct.toFixed(1)}%`
                                      : "-"}
                                  </span>
                                  <Badge variant="outline" className={`text-[10px] ${badge.className}`}>
                                    {badge.label}
                                  </Badge>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                                {menu.is_sellable && menu.selling_price > 0
                                  ? formatRupiah(menu.gross_margin)
                                  : "-"}
                              </td>
                            </tr>
                            {isExp && hasExpand && (
                              <tr className="bg-slate-50/80 dark:bg-slate-900/60">
                                <td colSpan={7} className="px-8 py-2.5">
                                  <div className="space-y-2">
                                    {ingRows.length > 0 && (
                                      <div className="space-y-1">
                                        <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                          Bahan Resep ({ingRows.length})
                                        </div>
                                        {ingRows.map((ing, idx) => (
                                          <div
                                            key={idx}
                                            className="flex justify-between text-[11px] border-b border-slate-200/70 dark:border-slate-800 pb-1 last:border-0"
                                          >
                                            <span>
                                              {ing.ingredient_name} ({ing.qty} {ing.unit})
                                            </span>
                                            <span className="tabular-nums font-medium">
                                              {formatRupiah(ing.line_cost || 0)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {pkgRows.length > 0 && (
                                      <div className="space-y-1 pt-1 border-t border-dashed border-amber-300 dark:border-amber-800">
                                        <div className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                                          Kemasan &amp; Packaging ({pkgRows.length})
                                        </div>
                                        {pkgRows.map((pkg, idx) => (
                                          <div
                                            key={idx}
                                            className="flex justify-between text-[11px]"
                                          >
                                            <span>
                                              {pkg.ingredient_name} ({pkg.qty} {pkg.unit})
                                            </span>
                                            <span className="tabular-nums font-medium">
                                              {formatRupiah(pkg.line_cost || 0)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {(menu.labor_cost || 0) > 0 && (
                                      <div className="flex justify-between text-[11px] font-medium text-slate-700 dark:text-slate-300 border-t border-dashed border-slate-300 dark:border-slate-700 pt-1">
                                        <span>+ Tenaga Kerja (Labor)</span>
                                        <span className="tabular-nums font-semibold">
                                          {formatRupiah(menu.unit_labor_cost ?? menu.labor_cost)}
                                        </span>
                                      </div>
                                    )}
                                    {menu.other_fee > 0 && (
                                      <div className="flex justify-between text-[11px] font-medium text-amber-700 dark:text-amber-400 border-t border-dashed border-slate-300 dark:border-slate-700 pt-1">
                                        <span>+ Biaya Lainnya</span>
                                        <span className="tabular-nums font-semibold">
                                          {formatRupiah(menu.unit_other_fee ?? menu.other_fee)}
                                        </span>
                                      </div>
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
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
