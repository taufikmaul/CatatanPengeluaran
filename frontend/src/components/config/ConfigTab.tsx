import React, { useState, useEffect } from "react";
import { SystemConfig } from "@/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Save,
  Bot,
  Sparkles,
  FileSpreadsheet,
  RefreshCw,
  Upload,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Database,
  ExternalLink,
  Target,
} from "lucide-react";

interface ConfigTabProps {
  config: SystemConfig | null;
  onRefreshConfig: () => void;
}

export const ConfigTab: React.FC<ConfigTabProps> = ({ config, onRefreshConfig }) => {
  // Form states
  const [telegramToken, setTelegramToken] = useState("");
  const [pinChatId, setPinChatId] = useState("");
  const [allowedThreadId, setAllowedThreadId] = useState(7);
  const [botPassword, setBotPassword] = useState("12345");
  const [webhookUrl, setWebhookUrl] = useState("");

  const [sumopodApiKey, setSumopodApiKey] = useState("");
  const [sumopodModel, setSumopodModel] = useState("seed-2-0-mini");
  const [sumopodUrl, setSumopodUrl] = useState("https://ai.sumopod.com/v1/chat/completions");

  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [monthlyBudgetLimit, setMonthlyBudgetLimit] = useState<number>(0);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>({});

  // UI helpers
  const [showTokens, setShowTokens] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isUploadingCreds, setIsUploadingCreds] = useState(false);

  // AI test
  const [aiTestText, setAiTestText] = useState("Beli terigu cakra 2 sak 520rb dan mentega 100rb lunas");
  const [aiTestResult, setAiTestResult] = useState<any | null>(null);
  const [isAiTesting, setIsAiTesting] = useState(false);

  // Sync state from config
  useEffect(() => {
    if (config) {
      setTelegramToken(config.telegram_token || "");
      setPinChatId(config.dashboard_pin_chat_id || "");
      setAllowedThreadId(config.allowed_thread_id || 7);
      setBotPassword(config.bot_password || "12345");
      setWebhookUrl(config.webhook_url || "");

      setSumopodApiKey(config.sumopod_api_key || "");
      setSumopodModel(config.ai_model || "seed-2-0-mini");
      setSumopodUrl(config.ai_url || "https://ai.sumopod.com/v1/chat/completions");

      setSpreadsheetId(config.spreadsheet_id || "");
      setMonthlyBudgetLimit(config.monthly_budget_limit || 0);
      setCategoryBudgets(config.category_budgets || {});
    }
  }, [config]);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const payload: any = {
        allowed_thread_id: Number(allowedThreadId),
        report_thread_id: Number(allowedThreadId),
        dashboard_pin_thread_id: Number(allowedThreadId),
        sumopod_model: sumopodModel,
        sumopod_url: sumopodUrl,
        spreadsheet_id: spreadsheetId.trim(),
        bot_password: botPassword,
        webhook_url: webhookUrl.trim(),
        monthly_budget_limit: Number(monthlyBudgetLimit) || 0,
        category_budgets: categoryBudgets,
      };

      if (telegramToken.trim()) payload.telegram_token = telegramToken.trim();
      if (pinChatId.trim()) payload.dashboard_pin_chat_id = pinChatId.trim();
      if (sumopodApiKey.trim()) payload.sumopod_api_key = sumopodApiKey.trim();

      const res = await api.put("/config", payload);
      toast.success(res.data.message || "Pengaturan berhasil disimpan!");
      onRefreshConfig();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal menyimpan pengaturan");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadCredentials = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    if (!file.name.endsWith(".json")) {
      toast.error("File harus berekstensi .json (Google Service Account key)");
      return;
    }

    setIsUploadingCreds(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await api.post("/config/upload-credentials", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(res.data.message || "File kredensial Google Service Account berhasil disimpan!");
      onRefreshConfig();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal mengunggah file kredensial");
    } finally {
      setIsUploadingCreds(false);
    }
  };

  const handleSyncSheets = async () => {
    setIsSyncing(true);
    try {
      const res = await api.post("/config/sync-sheets");
      if (res.data.synced_count > 0) {
        toast.success(`Sinkronisasi selesai! ${res.data.synced_count} baris data dikirim ke Google Sheets.`);
      } else {
        toast.info(res.data.message || "Tidak ada data baru yang perlu disinkronkan ke Google Sheets.");
      }
      onRefreshConfig();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal sinkronisasi ke Google Sheets");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestAi = async () => {
    if (!aiTestText.trim()) return;
    setIsAiTesting(true);
    try {
      const res = await api.post("/config/test-ai", { text: aiTestText });
      setAiTestResult(res.data.result);
      toast.success("AI berhasil mengekstrak data!");
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Gagal memproses tes AI");
    } finally {
      setIsAiTesting(false);
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} berhasil disalin ke clipboard!`);
  };

  if (!config) {
    return <div className="p-8 text-center text-slate-500">Memuat konfigurasi sistem...</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Banner Status */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 leading-tight">
              Status Basis Data & Sinkronisasi
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Total {config.total_expenses} transaksi • {config.unsynced_count} data belum disinkronkan ke Google Sheets
            </p>
          </div>
        </div>

        <Button
          size="sm"
          onClick={handleSyncSheets}
          disabled={isSyncing}
          className="rounded-xl text-xs bg-slate-900 hover:bg-slate-800 text-white gap-2 font-medium h-9 w-full md:w-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Menyinkronkan..." : "Sync ke Google Sheets Sekarang"}
        </Button>
      </div>

      <form onSubmit={handleSaveConfig} className="space-y-6">
        {/* 1. Telegram Bot Settings */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="p-4 md:p-5 pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm md:text-base font-semibold text-slate-900 flex items-center gap-2">
                <Bot className="w-5 h-5 text-blue-500" />
                Konfigurasi Telegram Bot
              </CardTitle>
              <button
                type="button"
                onClick={() => setShowTokens(!showTokens)}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 font-medium"
              >
                {showTokens ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showTokens ? "Sembunyikan Nilai Rahasia" : "Lihat Nilai"}
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-4 md:p-5 pt-0 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Telegram Bot Token
                </label>
                <Input
                  type={showTokens ? "text" : "password"}
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  placeholder={config.telegram_token_masked || "Masukkan token dari @BotFather"}
                  className="h-10 text-xs rounded-xl"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Format: <code>123456789:ABCdefGHIjkl...</code>
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Chat ID Penerima PIN Login & Laporan
                </label>
                <Input
                  type="text"
                  value={pinChatId}
                  onChange={(e) => setPinChatId(e.target.value)}
                  placeholder="Contoh: 123456789 atau -100123456789"
                  className="h-10 text-xs rounded-xl"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  User ID atau Group ID Telegram tujuan pengiriman PIN
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Topic / Thread ID (Untuk Forum Group)
                </label>
                <Input
                  type="number"
                  value={allowedThreadId}
                  onChange={(e) => setAllowedThreadId(Number(e.target.value))}
                  className="h-10 text-xs rounded-xl"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Default: 7 (Topic bot Catatan Pengeluaran)
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Password Bot Telegram
                </label>
                <Input
                  type="text"
                  value={botPassword}
                  onChange={(e) => setBotPassword(e.target.value)}
                  placeholder="Password untuk otorisasi user di Telegram"
                  className="h-10 text-xs rounded-xl"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Webhook URL (Opsional)
                </label>
                <Input
                  type="text"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://domain-anda.com/webhook"
                  className="h-10 text-xs rounded-xl"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 1.5 Target Anggaran Bulanan (Keseluruhan & Per Kategori) */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="p-4 md:p-5 pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <CardTitle className="text-sm md:text-base font-semibold text-slate-900 flex items-center gap-2">
                <Target className="w-5 h-5 text-emerald-600" />
                Target Anggaran Bulanan (Keseluruhan & Per Kategori)
              </CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const totalCat = Object.values(categoryBudgets).reduce(
                    (acc, val) => acc + (Number(val) || 0),
                    0
                  );
                  setMonthlyBudgetLimit(totalCat);
                  toast.info("Target keseluruhan disamakan dengan total anggaran kategori");
                }}
                className="h-8 rounded-xl text-xs font-semibold"
              >
                Σ Samakan Total dengan Jumlah Kategori
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-4 md:p-5 pt-0 space-y-4">
            <div className="p-3.5 bg-emerald-50/50 border border-emerald-200/70 rounded-2xl">
              <label className="text-xs font-bold text-emerald-950 block mb-1">
                Plafon Anggaran Keseluruhan Bulanan (Rp)
              </label>
              <Input
                type="number"
                step="any"
                value={monthlyBudgetLimit || ""}
                onChange={(e) => setMonthlyBudgetLimit(Number(e.target.value) || 0)}
                placeholder="Contoh: 20000000 (Kosongkan/0 jika ingin dihitung otomatis dari jumlah kategori)"
                className="h-10 text-xs rounded-xl bg-white"
              />
              <span className="text-[11px] text-emerald-700 mt-1 block">
                Jika diisi 0, plafon keseluruhan otomatis menggunakan hasil penjumlahan anggaran kategori di bawah.
              </span>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-2">
                Anggaran Per Kategori (Rp) — Isi hanya kategori yang ingin dibatasi:
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {(config.valid_categories || []).map((cat) => (
                  <div
                    key={cat}
                    className="p-2.5 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-1"
                  >
                    <label className="text-[11px] font-semibold text-slate-700 block truncate">
                      {cat}
                    </label>
                    <Input
                      type="number"
                      step="any"
                      value={categoryBudgets[cat] || ""}
                      onChange={(e) => {
                        const val = Number(e.target.value) || 0;
                        setCategoryBudgets((prev) => ({
                          ...prev,
                          [cat]: val,
                        }));
                      }}
                      placeholder="0 (Tanpa batas)"
                      className="h-8 text-xs rounded-lg bg-white"
                    />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 2. Sumopod AI Settings */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="p-4 md:p-5 pb-3">
            <CardTitle className="text-sm md:text-base font-semibold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              Hermes AI & Sumopod Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-5 pt-0 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Sumopod API Key
                </label>
                <Input
                  type={showTokens ? "text" : "password"}
                  value={sumopodApiKey}
                  onChange={(e) => setSumopodApiKey(e.target.value)}
                  placeholder={config.ai_key_masked || "sk-your-sumopod-api-key"}
                  className="h-10 text-xs rounded-xl"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Dapatkan di dashboard Sumopod AI
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Model AI
                </label>
                <div className="flex gap-2">
                  <select
                    value={sumopodModel}
                    onChange={(e) => setSumopodModel(e.target.value)}
                    className="h-10 rounded-xl border border-input bg-background px-3 text-xs font-medium focus:ring-2 focus:ring-blue-500 flex-1"
                  >
                    <option value="seed-2-0-mini">seed-2-0-mini (Cepat & Hemat)</option>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
                    <option value="claude-3-haiku">claude-3-haiku</option>
                  </select>
                  <Input
                    type="text"
                    value={sumopodModel}
                    onChange={(e) => setSumopodModel(e.target.value)}
                    placeholder="Custom Model"
                    className="h-10 text-xs rounded-xl w-36"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Sumopod Chat Completions Endpoint URL
                </label>
                <Input
                  type="text"
                  value={sumopodUrl}
                  onChange={(e) => setSumopodUrl(e.target.value)}
                  placeholder="https://ai.sumopod.com/v1/chat/completions"
                  className="h-10 text-xs rounded-xl"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 3. Google Sheets Integration */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="p-4 md:p-5 pb-3">
            <CardTitle className="text-sm md:text-base font-semibold text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              Integrasi Google Sheets
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-5 pt-0 space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Spreadsheet ID
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={spreadsheetId}
                  onChange={(e) => setSpreadsheetId(e.target.value)}
                  placeholder="Contoh: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                  className="h-10 text-xs rounded-xl font-mono flex-1"
                />
                {spreadsheetId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, "_blank")}
                    className="h-10 rounded-xl text-xs gap-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Buka Sheet
                  </Button>
                )}
              </div>
              <span className="text-[11px] text-slate-400 mt-1 block">
                ID spreadsheet diambil dari URL: <code>docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit</code>
              </span>
            </div>

            {/* Service Account File Upload */}
            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    File Kredensial Google Service Account (credentials.json)
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    File JSON key dari Google Cloud Console IAM & Admin
                  </p>
                </div>
                {config.sheets_creds_exists ? (
                  <Badge variant="success" className="text-[11px] gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    File Terpasang
                  </Badge>
                ) : (
                  <Badge variant="warning" className="text-[11px]">
                    Belum Terpasang
                  </Badge>
                )}
              </div>

              {/* Display Service Account Email to share with */}
              {config.service_account_email && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 space-y-1">
                  <div className="font-semibold flex items-center justify-between">
                    <span>Email Service Account:</span>
                    <button
                      type="button"
                      onClick={() => handleCopy(config.service_account_email!, "Email Service Account")}
                      className="text-emerald-700 hover:text-emerald-950 font-bold flex items-center gap-1 text-[11px]"
                    >
                      <Copy className="w-3 h-3" /> Salin Email
                    </button>
                  </div>
                  <code className="block bg-white/70 px-2 py-1 rounded font-mono text-[11px] text-emerald-800 break-all select-all">
                    {config.service_account_email}
                  </code>
                  <p className="text-[11px] text-emerald-700 mt-1">
                    💡 <strong>Penting:</strong> Bagikan (*Share*) spreadsheet Google Anda ke email di atas dengan akses <strong>Editor</strong> agar sync berjalan sukses.
                  </p>
                </div>
              )}

              {/* Upload input button */}
              <div className="flex items-center gap-2 pt-1">
                <label className="cursor-pointer">
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 shadow-xs transition-all">
                    <Upload className="w-3.5 h-3.5 text-blue-600" />
                    {isUploadingCreds ? "Mengunggah..." : "Unggah File credentials.json"}
                  </span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleUploadCredentials}
                    className="hidden"
                    disabled={isUploadingCreds}
                  />
                </label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Action Sticky / Float Bar */}
        <div className="flex justify-end gap-3 sticky bottom-4 bg-white/95 backdrop-blur-md p-3.5 rounded-2xl border border-slate-200 shadow-lg">
          <Button
            type="submit"
            disabled={isSaving}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl px-6 h-10 gap-2 shadow-sm"
          >
            <Save className="w-4 h-4" />
            {isSaving ? "Menyimpan Pengaturan..." : "Simpan Semua Pengaturan"}
          </Button>
        </div>
      </form>

      {/* AI Extraction Live Tester */}
      <Card className="border-slate-200 shadow-sm mt-8">
        <CardHeader className="p-4 md:p-5 pb-2">
          <CardTitle className="text-sm md:text-base font-semibold text-slate-800 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            Uji Coba Prompt & Ekstraksi AI (Live)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 md:p-5 pt-2 space-y-3">
          <p className="text-xs text-slate-500">
            Ketik teks transaksi nota/struk untuk melihat bagaimana model AI ({sumopodModel}) mem-parse barang, harga, dan kategori:
          </p>
          <div className="flex gap-2">
            <Input
              value={aiTestText}
              onChange={(e) => setAiTestText(e.target.value)}
              placeholder="Contoh: Beli telur 5 tray 250rb dari Toko Sumber Makmur lunas"
              className="text-xs rounded-xl"
            />
            <Button
              type="button"
              onClick={handleTestAi}
              disabled={isAiTesting}
              className="bg-slate-900 hover:bg-slate-800 text-white text-xs rounded-xl px-4 shrink-0 font-semibold"
            >
              {isAiTesting ? "Menganalisis..." : "Uji Ekstraksi"}
            </Button>
          </div>

          {aiTestResult && (
            <div className="mt-3 p-3.5 bg-slate-900 text-slate-100 rounded-2xl text-xs font-mono overflow-x-auto max-h-60">
              <pre>{JSON.stringify(aiTestResult, null, 2)}</pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
