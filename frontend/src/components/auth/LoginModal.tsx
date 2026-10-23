import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Send, KeyRound, ShieldAlert, CheckCircle2 } from "lucide-react";

const PIN_COOLDOWN_SECONDS = 30;
const COOLDOWN_STORAGE_KEY = "dashboard_pin_cooldown_until";

interface LoginModalProps {
  isOpen: boolean;
  onSuccess: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onSuccess }) => {
  const [pin, setPin] = useState("");
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [pinSent, setPinSent] = useState(false);

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
          <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-2 text-2xl">
            🎂
          </div>
          <DialogTitle className="text-lg font-bold text-slate-900">
            Login Catatan Pengeluaran
          </DialogTitle>
          <p className="text-xs text-slate-500">
            Akses dashboard dilindungi verifikasi PIN Telegram Historycake
          </p>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {!pinSent ? (
            <div className="text-center space-y-3">
              <p className="text-xs text-slate-600">
                Klik tombol di bawah ini untuk menerima 6-digit kode PIN verifikasi melalui Telegram bot.
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
                  Masukkan 6-Digit Kode PIN
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
                {isVerifying ? "Memverifikasi..." : "Masuk ke Dashboard"}
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleRequestPin}
                  disabled={cooldown > 0 || isRequesting}
                  className="text-xs text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline font-medium"
                >
                  {cooldown > 0 ? `Kirim ulang PIN dalam ${cooldown}d` : "Kirim Ulang PIN"}
                </button>
              </div>
            </form>
          )}

          <div className="p-3 bg-amber-50/60 border border-amber-200/60 rounded-xl flex items-center gap-2 text-[11px] text-amber-800">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Kode PIN berlaku 5 menit. Permintaan PIN dibatasi interval 30 detik untuk keamanan.</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
