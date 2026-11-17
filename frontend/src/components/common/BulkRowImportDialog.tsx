import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Copy, Table2 } from "lucide-react";
import { toast } from "sonner";

export interface BulkRowColumn<T extends Record<string, any>> {
  key: keyof T & string;
  label: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  widthClass?: string;
  min?: number;
}

interface BulkRowImportDialogProps<T extends Record<string, any>> {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  columns: BulkRowColumn<T>[];
  createEmptyRow: () => T;
  requiredKey: keyof T & string;
  onSubmit: (rows: T[], updateExisting: boolean) => Promise<void>;
  isSubmitting?: boolean;
  showUpdateExistingToggle?: boolean;
  submitLabel?: string;
}

export function BulkRowImportDialog<T extends Record<string, any>>({
  isOpen,
  onClose,
  title,
  description,
  columns,
  createEmptyRow,
  requiredKey,
  onSubmit,
  isSubmitting = false,
  showUpdateExistingToggle = true,
  submitLabel = "Simpan Semua",
}: BulkRowImportDialogProps<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [updateExisting, setUpdateExisting] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setRows([createEmptyRow(), createEmptyRow(), createEmptyRow()]);
    }
  }, [isOpen]);

  const updateCell = (rowIdx: number, key: string, val: any) => {
    setRows((prev) =>
      prev.map((row, idx) => (idx === rowIdx ? { ...row, [key]: val } : row))
    );
  };

  const addRows = (count: number) => {
    setRows((prev) => [
      ...prev,
      ...Array.from({ length: count }, () => createEmptyRow()),
    ]);
  };

  const duplicateRow = (idx: number) => {
    setRows((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, { ...prev[idx] });
      return next;
    });
  };

  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length <= 1 ? [createEmptyRow()] : prev.filter((_, i) => i !== idx)));
  };

  // Mendukung paste langsung dari Excel / Google Sheets (tab & newline)
  const handleCellPaste = (
    e: React.ClipboardEvent<HTMLInputElement>,
    startRowIdx: number,
    startColIdx: number
  ) => {
    const raw = e.clipboardData.getData("text/plain");
    if (!raw || (!raw.includes("\t") && !raw.includes("\n"))) {
      return;
    }
    e.preventDefault();
    const pastedLines = raw
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => line.length > 0);
    if (pastedLines.length === 0) return;

    setRows((prev) => {
      const next = [...prev];
      while (next.length < startRowIdx + pastedLines.length) {
        next.push(createEmptyRow());
      }
      pastedLines.forEach((line, rOffset) => {
        const cells = line.split("\t");
        const targetRow = { ...next[startRowIdx + rOffset] };
        cells.forEach((cellVal, cOffset) => {
          const col = columns[startColIdx + cOffset];
          if (!col) return;
          const clean = cellVal.trim();
          if (col.type === "number") {
            const num = Number(clean.replace(/[^\d.-]/g, ""));
            (targetRow as Record<string, any>)[col.key] = Number.isFinite(num) ? num : 0;
          } else if (col.type === "checkbox") {
            (targetRow as Record<string, any>)[col.key] = ["1", "true", "ya", "yes", "aktif"].includes(
              clean.toLowerCase()
            );
          } else {
            (targetRow as Record<string, any>)[col.key] = clean;
          }
        });
        next[startRowIdx + rOffset] = targetRow;
      });
      return next;
    });
    toast.info(`Menempel ${pastedLines.length} baris dari clipboard.`);
  };

  const validRows = rows.filter((r) => String(r[requiredKey] ?? "").trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validRows.length === 0) {
      toast.error("Isi minimal 1 baris data yang valid terlebih dahulu.");
      return;
    }
    await onSubmit(validRows, updateExisting);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Table2 className="w-5 h-5 text-blue-600" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {description} Anda juga dapat menyalin-tempel (Paste) baris langsung dari Excel atau Google Sheets ke sel tabel di bawah.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addRows(1)}
                className="h-8 text-xs gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                + 1 Baris
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addRows(5)}
                className="h-8 text-xs gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                + 5 Baris
              </Button>
            </div>
            <span className="text-slate-600 font-medium tabular-nums">
              {validRows.length} baris siap disimpan dari {rows.length} baris
            </span>
          </div>

          <div className="flex-1 min-h-[220px] max-h-[52vh] overflow-auto border border-slate-200 rounded-xl bg-white">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100 text-slate-700 border-b border-slate-200">
                <tr>
                  <th className="py-2 px-2.5 w-9 text-center font-semibold">#</th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={`py-2 px-2 font-semibold whitespace-nowrap ${col.widthClass || "min-w-[140px]"}`}
                    >
                      {col.label}
                      {col.required && <span className="text-rose-600 ml-0.5">*</span>}
                    </th>
                  ))}
                  <th className="py-2 px-2 w-16 text-center font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/70">
                    <td className="py-1.5 px-2 text-center text-slate-500 font-mono">
                      {rIdx + 1}
                    </td>
                    {columns.map((col, cIdx) => (
                      <td key={col.key} className="py-1.5 px-1.5">
                        {col.type === "select" ? (
                          <select
                            value={String(row[col.key] ?? "")}
                            onChange={(e) => updateCell(rIdx, col.key, e.target.value)}
                            className="w-full h-8 px-2 text-xs rounded-lg border border-input bg-white"
                          >
                            {(col.options || []).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        ) : col.type === "checkbox" ? (
                          <div className="flex justify-center">
                            <input
                              type="checkbox"
                              checked={Boolean(row[col.key])}
                              onChange={(e) => updateCell(rIdx, col.key, e.target.checked)}
                              className="w-4 h-4 rounded border-slate-300"
                            />
                          </div>
                        ) : (
                          <Input
                            type={col.type}
                            min={col.min}
                            value={row[col.key] ?? ""}
                            placeholder={col.placeholder}
                            onChange={(e) =>
                              updateCell(
                                rIdx,
                                col.key,
                                col.type === "number"
                                  ? e.target.value === ""
                                    ? ""
                                    : Number(e.target.value)
                                  : e.target.value
                              )
                            }
                            onPaste={(e) => handleCellPaste(e, rIdx, cIdx)}
                            className="h-8 text-xs rounded-lg"
                          />
                        )}
                      </td>
                    ))}
                    <td className="py-1.5 px-1.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => duplicateRow(rIdx)}
                          title="Duplikat baris"
                          className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRow(rIdx)}
                          title="Hapus baris"
                          className="p-1.5 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2">
            <div>
              {showUpdateExistingToggle && (
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                  <span>Perbarui data jika nama sudah ada</span>
                </label>
              )}
            </div>
            <div className="flex items-center gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                Batal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || validRows.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isSubmitting ? "Menyimpan..." : `${submitLabel} (${validRows.length})`}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
