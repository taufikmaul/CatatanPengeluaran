import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateMenuPricingChannels } from "@/lib/api";
import { PricingChannelConfig } from "@/types";
import { toast } from "sonner";
import { Percent, Plus, Trash2 } from "lucide-react";

interface PricingChannelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: PricingChannelConfig[];
}

export const PricingChannelsDialog: React.FC<PricingChannelsDialogProps> = ({
  open,
  onOpenChange,
  channels,
}) => {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<PricingChannelConfig[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDrafts(channels.map((ch) => ({ ...ch })));
      setErrorMsg(null);
    }
  }, [open, channels]);

  const saveMutation = useMutation({
    mutationFn: (next: PricingChannelConfig[]) => updateMenuPricingChannels(next),
    onSuccess: () => {
      toast.success("Pengaturan komisi channel penjualan berhasil disimpan.");
      queryClient.invalidateQueries({ queryKey: ["menu-pricing-channels"] });
      onOpenChange(false);
    },
    onError: (err: any) => {
      setErrorMsg(
        err?.response?.data?.detail || "Gagal menyimpan pengaturan komisi channel."
      );
    },
  });

  const handleAddChannel = () => {
    setDrafts((prev) => [
      ...prev,
      {
        key: `channel_${Date.now().toString(36)}`,
        name: "Channel Baru",
        commission_pct: 15,
        fixed_fee: 0,
        extra_packaging: 0,
      },
    ]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (drafts.length === 0) {
      setErrorMsg("Minimal harus ada satu channel penjualan.");
      return;
    }
    for (const d of drafts) {
      if (!d.name.trim()) {
        setErrorMsg("Nama channel tidak boleh kosong.");
        return;
      }
      if (d.commission_pct < 0 || d.commission_pct > 95) {
        setErrorMsg(`Komisi untuk "${d.name}" harus antara 0% sampai 95%.`);
        return;
      }
    }
    saveMutation.mutate(
      drafts.map((d, idx) => ({
        ...d,
        key: d.key.trim() || `ch_${idx + 1}`,
        name: d.name.trim(),
        commission_pct: Math.max(0, Math.min(95, Number(d.commission_pct) || 0)),
        fixed_fee: Math.max(0, Number(d.fixed_fee) || 0),
        extra_packaging: Math.max(0, Number(d.extra_packaging) || 0),
      }))
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent className="w-4 h-4 text-blue-600" />
            <span>Atur Komisi Channel Penjualan</span>
          </DialogTitle>
          <DialogDescription>
            Sesuaikan potongan komisi (%), biaya tetap per order (Rp), dan tambahan kemasan delivery untuk kalkulator harga jual per channel.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {errorMsg}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddChannel}
              className="h-8 text-xs gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Channel</span>
            </Button>
          </div>

          <div className="space-y-2">
            {drafts.map((ch, idx) => (
              <div
                key={ch.key || idx}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-2.5"
              >
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nama Channel
                  </label>
                  <Input
                    value={ch.name}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, name: e.target.value } : row
                        )
                      )
                    }
                    className="h-8 text-xs bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Komisi (%)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={95}
                    step="any"
                    value={ch.commission_pct}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? { ...row, commission_pct: Number(e.target.value) || 0 }
                            : row
                        )
                      )
                    }
                    className="h-8 text-xs tabular-nums bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Biaya Tetap (Rp)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={ch.fixed_fee}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? { ...row, fixed_fee: Number(e.target.value) || 0 }
                            : row
                        )
                      )
                    }
                    className="h-8 text-xs tabular-nums bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Ekstra Kemasan (Rp)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={ch.extra_packaging}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((row, i) =>
                          i === idx
                            ? { ...row, extra_packaging: Number(e.target.value) || 0 }
                            : row
                        )
                      )
                    }
                    className="h-8 text-xs tabular-nums bg-white dark:bg-slate-950"
                  />
                </div>
                <div className="sm:col-span-1 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={drafts.length <= 1}
                    onClick={() =>
                      setDrafts((prev) => prev.filter((_, i) => i !== idx))
                    }
                    aria-label={`Hapus channel ${ch.name}`}
                    className="h-8 w-8 p-0 text-slate-600 hover:text-rose-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saveMutation.isPending}
            >
              Batal
            </Button>
            <Button type="submit" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Menyimpan..." : "Simpan Channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
