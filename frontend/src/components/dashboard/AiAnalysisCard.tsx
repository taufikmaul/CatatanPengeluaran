import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAiAnalysis } from "@/lib/api";
import { AiAnalysisData } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  BrainCircuit,
  RefreshCw,
  Copy,
  Check,
  AlertTriangle,
  Lightbulb,
  FileText,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ChevronDown,
} from "lucide-react";

interface AiAnalysisCardProps {
  month: number;
  year: number;
  monthName: string;
}

export function AiAnalysisCard({ month, year, monthName }: AiAnalysisCardProps) {
  const queryClient = useQueryClient();
  const [isCopied, setIsCopied] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"recommendations" | "alerts" | "budget">("recommendations");

  // State collapsible (disimpan di localStorage agar preferensi tersimpan saat reload)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("hc_ai_analysis_collapsed");
      return saved === "true";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("hc_ai_analysis_collapsed", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Query: Mengambil analisis AI tersimpan / default
  const {
    data: analysis,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<AiAnalysisData>({
    queryKey: ["ai-analysis", month, year],
    queryFn: async () => {
      return await getAiAnalysis(month, year, false);
    },
    staleTime: 1000 * 60 * 30, // 30 menit
    retry: 1,
  });

  // Mutasi: Paksa analisis ulang (force refresh)
  const refreshMutation = useMutation({
    mutationFn: async () => {
      return await getAiAnalysis(month, year, true);
    },
    onSuccess: (newData) => {
      queryClient.setQueryData(["ai-analysis", month, year], newData);
      toast.success("Analisis AI berhasil diperbarui dengan data terkini!");
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Gagal memperbarui analisis AI");
    },
  });

  const handleCopySummary = () => {
    if (!analysis) return;
    const textToCopy = `[Analisis Keuangan Historycake - ${analysis.month_name} ${analysis.year}]
Status: ${analysis.health_status} (Skor: ${analysis.health_score}/100)

Ringkasan:
${analysis.summary}

Rekomendasi Utama:
${analysis.actionable_recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;

    navigator.clipboard.writeText(textToCopy);
    setIsCopied(true);
    toast.success("Ringkasan analisis disalin ke clipboard!");
    setTimeout(() => setIsCopied(false), 2000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "SEHAT":
        return {
          label: "Keuangan Sehat",
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
          classes: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
          scoreBg: "bg-emerald-500",
        };
      case "KRITIS":
        return {
          label: "Kritis / Boros",
          icon: <AlertCircle className="w-3.5 h-3.5 text-rose-600" />,
          classes: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
          scoreBg: "bg-rose-500",
        };
      case "PERLU_PERHATIAN":
      default:
        return {
          label: "Perlu Perhatian",
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />,
          classes: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
          scoreBg: "bg-amber-500",
        };
    }
  };

  const statusInfo = getStatusBadge(analysis?.health_status || "PERLU_PERHATIAN");

  return (
    <>
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 md:p-6 shadow-xs relative overflow-hidden transition-all">
        {/* Header Bar */}
        <div
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all ${
            isCollapsed ? "" : "pb-4 border-b border-slate-100 dark:border-slate-800"
          }`}
        >
          <div
            className="flex items-center gap-3 cursor-pointer select-none group min-w-0"
            onClick={toggleCollapsed}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggleCollapsed();
              }
            }}
            aria-expanded={!isCollapsed}
          >
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-amber-300 flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition-transform">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base md:text-lg leading-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  Evaluasi Finansial & Rekomendasi
                </h3>
                <span className="text-xs text-slate-500 font-medium hidden sm:inline">
                  • {monthName} {year}
                </span>

                {/* Status pill saat dalam mode ciut (collapsed) */}
                {isCollapsed && analysis && (
                  <Badge variant="outline" className={`px-2 py-0.5 rounded-lg gap-1 text-[11px] font-bold ${statusInfo.classes}`}>
                    {statusInfo.icon}
                    <span>{statusInfo.label}</span>
                    <span className="font-extrabold ml-0.5">({analysis.health_score}/100)</span>
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                {isCollapsed
                  ? "Klik untuk membuka analisis pengeluaran & rekomendasi strategis AI"
                  : "Analisis pengeluaran dan rekomendasi berbasis data transaksi toko Historycake"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            {analysis && !isCollapsed && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopySummary}
                className="h-9 px-3 rounded-xl border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 gap-1.5"
                title="Salin ringkasan ke clipboard"
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="hidden md:inline">{isCopied ? "Tersalin" : "Salin"}</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending || isLoading}
              className="h-9 px-3 rounded-xl border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 gap-1.5"
              title="Hitung ulang evaluasi AI"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? "animate-spin text-blue-600" : ""}`} />
              <span className="hidden sm:inline">{refreshMutation.isPending ? "Menganalisis..." : "Analisis Ulang"}</span>
            </Button>

            {/* Tombol Collapsible Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleCollapsed}
              aria-expanded={!isCollapsed}
              className="h-9 px-3 rounded-xl border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 gap-1.5"
              title={isCollapsed ? "Buka Evaluasi Finansial" : "Ciutkan Evaluasi Finansial"}
            >
              <span className="text-xs">{isCollapsed ? "Buka" : "Ciutkan"}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  isCollapsed ? "" : "rotate-180"
                }`}
              />
            </Button>
          </div>
        </div>

        {/* Content Body (Collapsible dengan AnimatePresence) */}
        <AnimatePresence initial={false}>
          {!isCollapsed && (
            <motion.div
              key="ai-content-body"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              {isLoading ? (
                <div className="py-6 space-y-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-6 w-32 rounded-lg" />
                    <Skeleton className="h-6 w-24 rounded-lg" />
                  </div>
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Skeleton className="h-28 rounded-xl" />
                    <Skeleton className="h-28 rounded-xl" />
                    <Skeleton className="h-28 rounded-xl" />
                  </div>
                </div>
              ) : isError ? (
                <div className="py-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div className="max-w-md mx-auto">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Gagal memuat analisis AI</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {(error as any)?.response?.data?.detail || "Terjadi kendala saat membaca data finansial bulan ini."}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => refetch()}
                    className="rounded-xl text-xs font-semibold"
                  >
                    Coba Lagi
                  </Button>
                </div>
              ) : analysis ? (
                <div className="pt-4 space-y-5">
                  {/* Skor Kesehatan Finansial & Badge Status */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 dark:bg-slate-800/50 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={`px-2.5 py-1 rounded-lg gap-1.5 text-xs font-bold ${statusInfo.classes}`}>
                        {statusInfo.icon}
                        <span>{statusInfo.label}</span>
                      </Badge>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        Skor Kesehatan Operasional:{" "}
                        <span className="font-bold text-slate-900 dark:text-slate-100">{analysis.health_score}</span> / 100
                      </div>
                    </div>

                    {/* Progress Bar Skor */}
                    <div className="flex items-center gap-2 w-full sm:w-48">
                      <div className="h-2 flex-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${statusInfo.scoreBg} transition-all duration-500`}
                          style={{ width: `${analysis.health_score}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
                        {analysis.health_score}%
                      </span>
                    </div>
                  </div>

                  {/* Ringkasan Eksekutif */}
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Ringkasan Eksekutif
                    </h4>
                    <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed font-normal">
                      {analysis.summary}
                    </p>
                  </div>

                  {/* Sub-tabs untuk Detail Insight */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 bg-slate-100/90 dark:bg-slate-800/80 p-1 rounded-xl text-xs font-semibold w-fit">
                      <button
                        onClick={() => setActiveTab("recommendations")}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                          activeTab === "recommendations"
                            ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                        <span>Saran Efisiensi</span>
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] ml-1 bg-slate-200/60 dark:bg-slate-700">
                          {analysis.actionable_recommendations.length}
                        </Badge>
                      </button>

                      <button
                        onClick={() => setActiveTab("alerts")}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                          activeTab === "alerts"
                            ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                        <span>Dinamika Harga</span>
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] ml-1 bg-slate-200/60 dark:bg-slate-700">
                          {analysis.price_alerts.length}
                        </Badge>
                      </button>

                      <button
                        onClick={() => setActiveTab("budget")}
                        className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                          activeTab === "budget"
                            ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        <HelpCircle className="w-3.5 h-3.5 text-blue-500" />
                        <span>Anggaran & Arus Kas</span>
                      </button>
                    </div>

                    {/* Tab Content 1: Rekomendasi Efisiensi */}
                    {activeTab === "recommendations" && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {analysis.actionable_recommendations.map((rec, idx) => (
                          <div
                            key={idx}
                            className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 rounded-xl p-3.5 space-y-1.5 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold flex items-center justify-center shrink-0">
                                {idx + 1}
                              </span>
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Langkah #{idx + 1}</span>
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-400 leading-normal pl-7">
                              {rec}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tab Content 2: Dinamika Harga & Anomali */}
                    {activeTab === "alerts" && (
                      <div className="space-y-2">
                        {analysis.price_alerts.length > 0 ? (
                          analysis.price_alerts.map((alert, idx) => (
                            <div
                              key={idx}
                              className="bg-rose-50/40 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-300"
                            >
                              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                              <span className="leading-relaxed">{alert}</span>
                            </div>
                          ))
                        ) : (
                          <div className="p-4 text-center text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-800">
                            Tidak ada lonjakan harga abnormal yang terdeteksi bulan ini.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tab Content 3: Anggaran & Arus Kas */}
                    {activeTab === "budget" && (
                      <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 rounded-xl p-4 space-y-2.5">
                        <div className="flex items-center gap-2">
                          <HelpCircle className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                            Kesehatan Arus Kas & Anggaran
                          </h5>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          {analysis.budget_analysis ||
                            "Alokasi belanja bulan ini berada dalam batas wajar kapasitas operasional toko."}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Footer Bar: Tombol Laporan Lengkap & Info Waktu */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-2 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
                    <div>
                      Dianalisis pada: {analysis.analyzed_at}{" "}
                      {analysis.cached ? <span className="text-slate-500">(cache cepat)</span> : ""}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setIsModalOpen(true)}
                      className="h-8 px-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/50 gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Baca Laporan Selengkapnya</span>
                    </Button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modal Dialog: Laporan Detail Markdown */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto dark:bg-slate-900 dark:border-slate-800">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-amber-500" />
              <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Laporan Lengkap Analisis Finansial
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-500">
              Periode {analysis?.month_name} {analysis?.year} • Evaluasi AI Historycake
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-4 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700 whitespace-pre-wrap font-sans text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
              {analysis?.markdown_report}
            </div>
          </div>

          <div className="flex justify-between items-center pt-3 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Skor Kesehatan: {analysis?.health_score}/100 ({analysis?.health_status})
            </span>
            <Button
              onClick={handleCopySummary}
              size="sm"
              className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Salin Ringkasan</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
