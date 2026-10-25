import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
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
      await api.post("/auth/verify-pin", { pin });
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
      <DialogContent className="max-w-sm rounded-3xl p-6">
        <DialogHeader className="text-center">
          <div className="w-12 h-12 bg-rose-50 text-rose-600 border border-rose-200/80 rounded-2xl flex items-center justify-center mx-auto mb-2 font-bold text-base tracking-tight select-none">
            HC
          </div>
          <DialogTitle className="text-lg font-bold text-slate-900">
            Login Catatan Pengeluaran
          </DialogTitle>
          <p className="text-xs text-slate-500">
            Pilih akses sesuai peran Anda di Historycake
          </p>
        </DialogHeader>

        {/* Mode Selector Tabs */}
        <div className="grid grid-cols-2 gap-1 bg-slate-100 p-1 rounded-2xl text-xs font-semibold mt-2">
          <button
            type="button"
            onClick={() => setLoginMode("admin_input")}
            className={`py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              loginMode === "admin_input"
                ? "bg-white text-amber-700 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Admin Input</span>
          </button>
          <button
            type="button"
            onClick={() => setLoginMode("owner")}
            className={`py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              loginMode === "owner"
                ? "bg-white text-blue-700 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Owner PIN</span>
          </button>
        </div>

        <div className="space-y-4 pt-2">
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
                    className="h-11 rounded-xl border-slate-200 pr-10 text-sm"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowAdminPassword(!showAdminPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
                    title={showAdminPassword ? "Sembunyikan" : "Tampilkan"}
                  >
                    {showAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isAdminInputLoggingIn || !adminInputPassword.trim()}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold h-11 gap-2 shadow-xs"
              >
                <PenTool className="w-4 h-4" />
                {isAdminInputLoggingIn ? "Memeriksa..." : "Masuk sebagai Admin Input"}
              </Button>

              <div className="p-3 bg-amber-50/70 border border-amber-200/70 rounded-xl text-[11px] text-amber-900 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <span>✨ Akses Khusus Admin Input:</span>
                </div>
                <p className="text-amber-800 leading-relaxed">
                  Bisa mencatat pengeluaran baru dan koreksi transaksi tanpa tombol hapus & tanpa grafik statistik yang rumit.
                </p>
              </div>
            </form>
          )}

          {/* TAB 2: OWNER (PIN TELEGRAM) LOGIN */}
          {loginMode === "owner" && (
            <div className="space-y-3.5">
              {!pinSent ? (
                <div className="text-center space-y-3">
                  <p className="text-xs text-slate-600">
                    Klik tombol di bawah ini untuk menerima 6-digit kode PIN verifikasi melalui bot Telegram Historycake.
                  </p>
                  <Button
                    onClick={handleRequestPin}
                    disabled={isRequesting || cooldown > 0}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold h-10 gap-2"
                  >
                    <Send className="w-4 h-4" />
                    {isRequesting
                      ? "Mengirim ke Telegram..."
                      : cooldown > 0
                      ? `Tunggu ${cooldown} detik`
                      : "Minta PIN ke Telegram"}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleVerify} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-600 block text-center">
                      Masukkan 6-Digit Kode PIN Telegram
                    </label>
                    <Input
                      type="text"
                      maxLength={6}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                      placeholder="• • • • • •"
                      className="text-center text-xl tracking-widest font-mono h-12 rounded-xl border-slate-200"
                      autoFocus
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isVerifying || pin.length < 4}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold h-10 gap-2"
                  >
                    <KeyRound className="w-4 h-4" />
                    {isVerifying ? "Memverifikasi..." : "Masuk sebagai Owner"}
                  </Button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleRequestPin}
                      disabled={cooldown > 0 || isRequesting}
                      className="text-xs text-blue-600 hover:underline disabled:text-slate-500 disabled:no-underline font-medium"
                    >
                      {cooldown > 0 ? `Kirim ulang PIN dalam ${cooldown}d` : "Kirim Ulang PIN"}
                    </button>
                  </div>
                </form>
              )}

              <div className="p-3 bg-blue-50/60 border border-blue-200/60 rounded-xl flex items-center gap-2 text-[11px] text-blue-800">
                <ShieldAlert className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Akses penuh Owner: Analisis grafik statistik, kelola sistem, & hak hapus transaksi.</span>
              </div>

              <div className="pt-1 text-center">
                <a
                  href={(import.meta as any).env?.VITE_HUB_URL || "http://localhost:5174"}
                  className="text-xs text-slate-500 hover:text-slate-900 underline underline-offset-4"
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
