import React, { useEffect, useState } from "react";
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
import { MenuProduct } from "@/types";
import { Copy } from "lucide-react";

interface CloneScaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceMenu: MenuProduct | null;
  isSubmitting: boolean;
  onConfirm: (payload: {
    menuId: number;
    newName: string;
    scaleFactor: number;
    scalePackaging: boolean;
  }) => void;
}

const SCALE_PRESETS = [
  { label: "0.5x", value: "0.5" },
  { label: "1x (Sama)", value: "1" },
  { label: "1.56x (16cm ke 20cm)", value: "1.56" },
  { label: "2x", value: "2" },
];

export const CloneScaleDialog: React.FC<CloneScaleDialogProps> = ({
  open,
  onOpenChange,
  sourceMenu,
  isSubmitting,
  onConfirm,
}) => {
  const [newName, setNewName] = useState("");
  const [scaleFactor, setScaleFactor] = useState("1");
  const [scalePackaging, setScalePackaging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open && sourceMenu) {
      setNewName(`${sourceMenu.name} (Salinan)`);
      setScaleFactor("1");
      setScalePackaging(false);
      setErrorMsg(null);
    }
  }, [open, sourceMenu]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceMenu) return;
    setErrorMsg(null);
    const clean = newName.trim();
    const factorNum = Number(scaleFactor);
    if (!clean) {
      setErrorMsg("Nama menu baru wajib diisi.");
      return;
    }
    if (Number.isNaN(factorNum) || factorNum <= 0 || factorNum > 100) {
      setErrorMsg("Faktor skala harus lebih dari 0 dan maksimal 100.");
      return;
    }
    onConfirm({
      menuId: sourceMenu.id,
      newName: clean,
      scaleFactor: factorNum,
      scalePackaging,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="w-4 h-4 text-blue-600" />
            <span>Duplikasi &amp; Skala Resep</span>
          </DialogTitle>
          <DialogDescription>
            Salin resep <strong>{sourceMenu?.name}</strong> ke menu baru sambil menskalakan seluruh takaran bahan dan hasil batch secara otomatis.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {errorMsg}
            </div>
          )}

          <div>
            <label
              htmlFor="clone-menu-name"
              className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Nama Menu / Sub-Resep Baru
            </label>
            <Input
              id="clone-menu-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Contoh: Classic Tiramisu 20cm"
              className="h-9 text-xs"
              required
            />
          </div>

          <div>
            <label
              htmlFor="clone-scale-factor"
              className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Pengali Takaran Resep (Scale Factor)
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {SCALE_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setScaleFactor(p.value)}
                  className={`px-2.5 py-1 rounded-md border text-[11px] font-medium transition-colors ${
                    scaleFactor === p.value
                      ? "bg-blue-50 border-blue-600 text-blue-800 dark:bg-blue-950/60 dark:border-blue-400 dark:text-blue-200"
                      : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Input
              id="clone-scale-factor"
              type="number"
              min={0.01}
              max={100}
              step="any"
              value={scaleFactor}
              onChange={(e) => setScaleFactor(e.target.value)}
              className="h-9 text-xs tabular-nums"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={scalePackaging}
              onChange={(e) => setScalePackaging(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            <span>Ikut kalikan jumlah Kemasan &amp; Packaging</span>
          </label>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Menduplikasi..." : "Duplikasi Resep"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
