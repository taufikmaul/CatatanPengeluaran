import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { getHubUrl } from "@/lib/hub";
import { toast } from "sonner";
import { Send, KeyRound, ShieldAlert, PenTool, ShieldCheck, Eye, EyeOff } from "lucide-react";

const PIN_COOLDOWN_SECONDS = 30;
const COOLDOWN_STORAGE_KEY = "dashboard_pin_cooldown_until";

interface LoginModalProps {
  isOpen: boolean;
  onSuccess: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onSuccess }) => {
  // Login Mode: "admin_input" | "owner"
  const [loginMode, setLoginMode] = useState<"admin_input" | "owner">("admin_input");

  // State untuk Admin Input
  const [adminInputPassword, setAdminInputPassword] = useState("");
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [isAdminInputLoggingIn, setIsAdminInputLoggingIn] = useState(false);

  // State untuk Owner (PIN Telegram)
  const [pin, setPin] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [pinSent, setPinSent] = useState(false);

  // Deteksi query param ?role=input atau ?role=owner
  useEffect(() => {
    if (!isOpen) return;
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const roleParam = searchParams.get("role") || searchParams.get("akses") || searchParams.get("mode");
      if (roleParam === "owner" || roleParam === "admin") {
        setLoginMode("owner");
      } else if (roleParam === "input" || roleParam === "admin_input") {
        setLoginMode("admin_input");
      }
    } catch {
      // Abaikan jika window.location tidak tersedia
    }
  }, [isOpen]);

  // Inisialisasi sisa cooldown dari localStorage saat modal aktif
  useEffect(() => {
    if (!isOpen) return;
    try {
      const stored = localStorage.getItem(COOLDOWN_STORAGE_KEY);
      if (stored) {
        const target = parseInt(stored, 10);
        const remaining = Math.ceil((target - Date.now()) / 1000);
        if (remaining > 0) {
          setCooldown(remaining);
          setPinSent(true);
        } else {
          localStorage.removeItem(COOLDOWN_STORAGE_KEY);
        }
      }
    } catch {
      // Abaikan jika localStorage tidak dapat diakses
    }
  }, [isOpen]);

  // Timer cooldown interval per detik
  useEffect(() => {
    if (cooldown <= 0) {
      try {
        localStorage.removeItem(COOLDOWN_STORAGE_KEY);
      } catch {
        // Abaikan
      }
      return;
    }

    const interval = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          try {
            localStorage.removeItem(COOLDOWN_STORAGE_KEY);
          } catch {
            // Abaikan
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldown]);

  const startCooldown = (seconds: number = PIN_COOLDOWN_SECONDS) => {
    setCooldown(seconds);
    try {
      localStorage.setItem(COOLDOWN_STORAGE_KEY, String(Date.now() + seconds * 1000));
    } catch {
      // Abaikan
    }
  };

  const handleAdminInputSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminInputPassword.trim()) {
      toast.error("Masukkan password Admin Input");
      return;
    }

    setIsAdminInputLoggingIn(true);
    try {
      const res = await api.post("/auth/login-admin-input", {
        password: adminInputPassword.trim(),
      });
      if (res.data?.token) {
        localStorage.setItem("dashboard_session_token", res.data.token);
        localStorage.removeItem("hcteams_token");
      }
      toast.success(res.data.message || "Login Admin Input berhasil!");
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Password Admin Input salah atau akses diblokir");
    } finally {
      setIsAdminInputLoggingIn(false);
    }
  };

  const handleRequestPin = async () => {
    if (cooldown > 0 || isRequesting) return;

    setIsRequesting(true);
    try {
      const res = await api.post("/auth/request-pin");
      toast.success(res.data.message || "Kode PIN 6-digit telah dikirim ke Telegram!");
      
      // Auto-fill jika terdeteksi Dev Mode PIN
      if (res.data.message && res.data.message.includes("[DEV MODE]")) {
        const match = res.data.message.match(/\b\d{6}\b/);
        if (match) {
          setPin(match[0]);
        }
      }

      setPinSent(true);
      startCooldown(PIN_COOLDOWN_SECONDS);
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || "Gagal meminta kode PIN";
      toast.error(errorMsg);

      // Jika response mengandung waktu tunggu, sinkronkan cooldown
      const match = errorMsg.match(/tunggu\s+(\d+)\s+detik/i);
      if (match) {
        const waitSec = parseInt(match[1], 10);
        startCooldown(waitSec);
        setPinSent(true);
      }
    } finally {
      setIsRequesting(false);
    }
  };

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (pin.length < 4) {
      toast.error("Masukkan kode PIN yang valid");
      return;
    }

    setIsVerifying(true);
    try {
      const res = await api.post("/auth/verify-pin", { pin });
      if (res.data?.token) {
        localStorage.setItem("dashboard_session_token", res.data.token);
        localStorage.removeItem("hcteams_token");
      }
      toast.success("Login berhasil! Selamat datang kembali.");
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Kode PIN salah atau telah kedaluwarsa");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm rounded-2xl p-7 border border-slate-200 bg-white shadow-sm font-sans">
        <DialogHeader className="text-center">
          <div
            className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 text-2xl flex items-center justify-center mx-auto mb-3 select-none shadow-2xs"
            role="img"
            aria-label="History Cake"
          >
            🎂
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-slate-900">
            Catatan Pengeluaran
          </DialogTitle>
          <p className="text-xs text-slate-500 mt-0.5">
            HCTeams Suite — Keuangan & Operasional
          </p>
        </DialogHeader>

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold mt-1">
          <button
            type="button"
            onClick={() => setLoginMode("admin_input")}
            className={`py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              loginMode === "admin_input"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Admin Input</span>
          </button>
          <button
            type="button"
            onClick={() => setLoginMode("owner")}
            className={`py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              loginMode === "owner"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Owner PIN</span>
          </button>
        </div>

        <div className="space-y-4 pt-1">
          {/* TAB 1: ADMIN INPUT LOGIN */}
          {loginMode === "admin_input" && (
            <form onSubmit={handleAdminInputSubmit} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 block">
                  Password Admin Input
                </label>
                <div className="relative">
                  <Input
                    type={showAdminPassword ? "text" : "password"}
                    value={adminInputPassword}
                    onChange={(e) => setAdminInputPassword(e.target.value)}
                    placeholder="Masukkan password..."
                    className="h-11 rounded-xl border-slate-300 pr-10 text-sm focus:border-slate-400 focus:ring-slate-400"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    title={showAdminPassword ? "Sembunyikan" : "Tampilkan"}
                  >
                    {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isAdminInputLoggingIn || !adminInputPassword.trim()}
                className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl text-xs font-semibold h-10 gap-2 shadow-xs transition-colors"
              >
                <PenTool className="w-3.5 h-3.5" />
                {isAdminInputLoggingIn ? "Memeriksa..." : "Masuk sebagai Admin Input"}
              </Button>

              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-[11px] text-slate-500 leading-relaxed text-center">
                Mencatat pengeluaran harian dan koreksi transaksi tanpa izin hapus atau statistik owner.
              </div>
            </form>
          )}

          {/* TAB 2: OWNER (PIN TELEGRAM) LOGIN */}
          {loginMode === "owner" && (
            <div className="space-y-3.5">
              {!pinSent ? (
                <div className="text-center space-y-3">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Klik tombol di bawah ini untuk menerima 6-digit kode PIN verifikasi melalui bot Telegram Historycake.
                  </p>
                  <Button
                    onClick={handleRequestPin}
                    disabled={isRequesting || cooldown > 0}
                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl text-xs font-semibold h-10 gap-2 shadow-xs transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {isRequesting
                      ? "Mengirim ke Telegram..."
                      : cooldown > 0
                      ? `Tunggu ${cooldown} detik`
                      : "Minta PIN ke Telegram"}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleVerify} className="space-y-3.5">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700">
                        Kode 6-Digit PIN
                      </label>
                      <button
                        type="button"
                        onClick={handleRequestPin}
                        disabled={cooldown > 0 || isRequesting}
                        className="text-xs font-semibold text-slate-900 hover:text-slate-700 disabled:text-slate-400 transition-colors inline-flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" />
                        <span>{cooldown > 0 ? `Kirim ulang (${cooldown}d)` : "Kirim PIN lagi"}</span>
                      </button>
                    </div>
                    <Input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="w-full px-3 py-3 text-center text-xl font-bold tracking-[0.45em] border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-400 placeholder:tracking-normal placeholder:font-normal placeholder:text-sm text-slate-900 h-11"
                      autoFocus
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isVerifying || pin.length < 4}
                    className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl text-xs font-semibold h-10 gap-2 shadow-xs transition-colors"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    {isVerifying ? "Memverifikasi..." : "Masuk sebagai Owner"}
                  </Button>
                </form>
              )}

              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-[11px] text-slate-500 leading-relaxed text-center">
                Akses penuh Owner: Analisis grafik keuangan, kelola sistem, & izin hapus transaksi.
              </div>

              <div className="pt-1 text-center">
                <a
                  href={getHubUrl()}
                  className="text-xs text-slate-500 hover:text-slate-900 underline underline-offset-4 font-medium transition-colors"
                >
                  Atau masuk via HCTeams Hub (SSO)
                </a>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
