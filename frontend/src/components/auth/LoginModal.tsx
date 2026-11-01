import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { getHubUrl } from "@/lib/hub";
import { toast } from "sonner";
import {
  Send,
  KeyRound,
  ShieldAlert,
  PenTool,
  ShieldCheck,
  Eye,
  EyeOff,
  ShoppingBag,
  ShoppingBasket,
  PackageCheck,
  Crown,
} from "lucide-react";

const PIN_COOLDOWN_SECONDS = 30;
const COOLDOWN_STORAGE_KEY = "dashboard_pin_cooldown_until";

export type LoginMode = "staff" | "purchasing" | "warehouse" | "admin_input" | "owner";

interface LoginModalProps {
  isOpen: boolean;
  onSuccess: () => void;
}

const ROLES_INFO: Record<
  LoginMode,
  {
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    desc: string;
    badgeColor: string;
  }
> = {
  staff: {
    label: "Staf Dapur / Toko",
    shortLabel: "Staf Dapur",
    icon: <ShoppingBag className="w-4 h-4 text-amber-500" />,
    desc: "Akses cepat untuk listing & mengajukan kebutuhan belanja bahan dapur.",
    badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
  },
  purchasing: {
    label: "Bagian Purchasing",
    shortLabel: "Purchasing",
    icon: <ShoppingBasket className="w-4 h-4 text-emerald-600" />,
    desc: "Akses pemesanan ke supplier, salin format WhatsApp, & tandai pesanan.",
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  warehouse: {
    label: "Bagian Gudang",
    shortLabel: "Gudang",
    icon: <PackageCheck className="w-4 h-4 text-blue-600" />,
    desc: "Akses pemeriksaan fisik barang tiba, cek kesesuaian qty, & input Exp Date.",
    badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
  },
  admin_input: {
    label: "Admin Input",
    shortLabel: "Admin Input",
    icon: <PenTool className="w-4 h-4 text-slate-600" />,
    desc: "Akses pencatatan transaksi & struk pengeluaran operasional toko.",
    badgeColor: "bg-slate-50 text-slate-700 border-slate-200",
  },
  owner: {
    label: "Owner / Super Admin",
    shortLabel: "Owner",
    icon: <Crown className="w-4 h-4 text-rose-500" />,
    desc: "Akses penuh ke semua laporan keuangan, approval belanja, & konfigurasi.",
    badgeColor: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onSuccess }) => {
  // Login Mode: "staff" | "purchasing" | "warehouse" | "admin_input" | "owner"
  const [loginMode, setLoginMode] = useState<LoginMode>("staff");

  // State untuk Role Password (Staff, Purchasing, Warehouse, Admin Input)
  const [rolePassword, setRolePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isRoleLoggingIn, setIsRoleLoggingIn] = useState(false);

  // State untuk Owner (PIN Telegram)
  const [pin, setPin] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [pinSent, setPinSent] = useState(false);

  // Deteksi query param ?role=staff | purchasing | gudang | input | owner
  useEffect(() => {
    if (!isOpen) return;
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const roleParam = (
        searchParams.get("role") ||
        searchParams.get("akses") ||
        searchParams.get("mode") ||
        ""
      ).toLowerCase();

      if (roleParam === "owner" || roleParam === "admin") {
        setLoginMode("owner");
      } else if (roleParam === "purchasing") {
        setLoginMode("purchasing");
      } else if (roleParam === "gudang" || roleParam === "warehouse") {
        setLoginMode("warehouse");
      } else if (roleParam === "input" || roleParam === "admin_input") {
        setLoginMode("admin_input");
      } else if (roleParam === "staff" || roleParam === "staf" || roleParam === "dapur") {
        setLoginMode("staff");
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

  const handleRoleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rolePassword.trim()) {
      toast.error(`Masukkan password ${ROLES_INFO[loginMode].shortLabel}`);
      return;
    }

    setIsRoleLoggingIn(true);
    try {
      const res = await api.post("/auth/login-role", {
        role: loginMode,
        password: rolePassword.trim(),
      });
      if (res.data?.token) {
        localStorage.setItem("dashboard_session_token", res.data.token);
        localStorage.removeItem("hcteams_token");
      }
      toast.success(res.data.message || `Login ${ROLES_INFO[loginMode].label} berhasil!`);
      setRolePassword("");
      onSuccess();
    } catch (err: any) {
      toast.error(
        err.response?.data?.error ||
          `Password ${ROLES_INFO[loginMode].shortLabel} salah atau akses diblokir`
      );
    } finally {
      setIsRoleLoggingIn(false);
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

  const handleVerifyOwnerPin = async (e?: React.FormEvent) => {
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
      toast.success("Login Owner berhasil! Selamat datang kembali.");
      setPin("");
      onSuccess();
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Kode PIN salah atau telah kedaluwarsa");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="max-w-md w-full rounded-2xl p-6 sm:p-7 border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-xl font-sans">
        <DialogHeader className="text-center">
          <div
            className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-2xl flex items-center justify-center mx-auto mb-2.5 select-none shadow-sm"
            role="img"
            aria-label="History Cake"
          >
            🎂
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-slate-900 dark:text-zinc-100">
            Login Bagian / Divisi
          </DialogTitle>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Pilih bagian Anda untuk mengakses menu kerja yang sesuai
          </p>
        </DialogHeader>

        {/* Role Selector Tabs (5 Divisi) */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 bg-slate-100 dark:bg-zinc-900 p-1.5 rounded-xl text-xs font-semibold mt-2">
          {(Object.keys(ROLES_INFO) as LoginMode[]).map((r) => {
            const info = ROLES_INFO[r];
            const isActive = loginMode === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setLoginMode(r);
                  setRolePassword("");
                }}
                className={`py-2 px-2 rounded-lg transition-all flex flex-col items-center justify-center gap-1 ${
                  isActive
                    ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-zinc-100 shadow-sm font-bold border border-slate-200/80 dark:border-zinc-700"
                    : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200"
                }`}
              >
                {info.icon}
                <span className="text-[11px] leading-tight text-center">{info.shortLabel}</span>
              </button>
            );
          })}
        </div>

        {/* Info Banner Peran Terpilih */}
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/60 dark:border-zinc-800/80 flex items-start gap-2.5 text-xs text-slate-600 dark:text-zinc-400">
          <div className="shrink-0 mt-0.5">{ROLES_INFO[loginMode].icon}</div>
          <div>
            <span className="font-bold text-slate-900 dark:text-zinc-200">
              {ROLES_INFO[loginMode].label}:
            </span>{" "}
            {ROLES_INFO[loginMode].desc}
          </div>
        </div>

        {/* FORM LOGIN SESUAI ROLE */}
        <div className="space-y-4 pt-1">
          {/* Form Role Password (Staff, Purchasing, Warehouse, Admin Input) */}
          {loginMode !== "owner" ? (
            <form onSubmit={handleRoleSubmit} className="space-y-3.5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 block">
                  Password {ROLES_INFO[loginMode].label}
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={rolePassword}
                    onChange={(e) => setRolePassword(e.target.value)}
                    placeholder={`Masukkan password ${ROLES_INFO[loginMode].shortLabel}...`}
                    className="h-11 rounded-xl border-slate-300 dark:border-zinc-700 pr-10 text-sm focus:border-slate-400"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300 focus:outline-none"
                    aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isRoleLoggingIn || !rolePassword.trim()}
                className="w-full h-11 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-900 text-white font-semibold text-sm transition-all"
              >
                {isRoleLoggingIn ? "Memverifikasi..." : `Masuk sebagai ${ROLES_INFO[loginMode].shortLabel}`}
              </Button>
            </form>
          ) : (
            /* Form Owner PIN (Telegram PIN) */
            <div className="space-y-3.5">
              {!pinSent ? (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed text-center">
                    Untuk akses Owner, kode PIN keamanan 6-digit akan dikirimkan langsung ke Telegram terdaftar.
                  </p>
                  <Button
                    type="button"
                    onClick={handleRequestPin}
                    disabled={isRequesting || cooldown > 0}
                    className="w-full h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm transition-all flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    {isRequesting
                      ? "Mengirim..."
                      : cooldown > 0
                      ? `Tunggu ${cooldown}s`
                      : "Minta PIN via Telegram"}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleVerifyOwnerPin} className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-zinc-300 block">
                      Kode PIN Telegram (6 Digit)
                    </label>
                    <Input
                      type="text"
                      maxLength={6}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                      placeholder="Contoh: 123456"
                      className="h-11 rounded-xl border-slate-300 dark:border-zinc-700 text-center text-lg font-mono tracking-widest"
                      autoFocus
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isVerifying || pin.length < 4}
                    className="w-full h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-sm transition-all"
                  >
                    {isVerifying ? "Memverifikasi..." : "Verifikasi & Masuk Owner"}
                  </Button>

                  <div className="text-center pt-1">
                    <button
                      type="button"
                      onClick={handleRequestPin}
                      disabled={cooldown > 0 || isRequesting}
                      className="text-xs text-slate-500 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-zinc-200 underline"
                    >
                      {cooldown > 0 ? `Kirim ulang dalam ${cooldown}s` : "Kirim ulang PIN"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Link ke Hub / Catatan Bantuan */}
        <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 text-center">
          <p className="text-[11px] text-slate-400 dark:text-zinc-500">
            Historycake Bakery · Sistem Operasional & Catatan Belanja
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
