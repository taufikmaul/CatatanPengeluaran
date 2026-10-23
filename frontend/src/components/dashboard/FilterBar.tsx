import React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, RotateCcw, Plus, Filter } from "lucide-react";

interface FilterBarProps {
  month: number;
  year: number;
  selectedCategory: string;
  search: string;
  status: string;
  isReimbursement?: boolean | null;
  categories: string[];
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
  onCategoryChange: (category: string) => void;
  onSearchChange: (search: string) => void;
  onStatusChange: (status: string) => void;
  onReimbursementChange?: (val: boolean | null) => void;
  onReset: () => void;
  onOpenAddExpense: () => void;
}

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export const FilterBar: React.FC<FilterBarProps> = ({
  month,
  year,
  selectedCategory,
  search,
  status,
  isReimbursement,
  categories,
  onMonthChange,
  onYearChange,
  onCategoryChange,
  onSearchChange,
  onStatusChange,
  onReimbursementChange,
  onReset,
  onOpenAddExpense,
}) => {
  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Cari nama barang, supplier, catatan..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 pr-4 h-10 rounded-xl bg-slate-50/50 border-slate-200 focus:bg-white text-sm"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
            >
              Clear
            </button>
          )}
        </div>

        {/* Add Expense Action Button */}
        <Button
          onClick={onOpenAddExpense}
          className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm gap-2 h-10 font-semibold px-4 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Tambah Catatan
        </Button>
      </div>

      {/* Filter Selectors Row */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 mr-1">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter:</span>
        </div>

        {/* Month Selector */}
        <select
          value={month}
          onChange={(e) => onMonthChange(Number(e.target.value))}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>

        {/* Year Selector */}
        <select
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          {[2024, 2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        {/* Category Dropdown */}
        <select
          value={selectedCategory}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer max-w-[140px] truncate"
        >
          <option value="">Semua Kategori</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        {/* Status Pills */}
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg ml-auto md:ml-0">
          <button
            onClick={() => onStatusChange("")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              status === "" ? "bg-white text-slate-900 shadow-xs font-semibold" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Semua
          </button>
          <button
            onClick={() => onStatusChange("Lunas")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              status === "Lunas" ? "bg-emerald-500 text-white shadow-xs font-semibold" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Lunas
          </button>
          <button
            onClick={() => onStatusChange("Belum Lunas")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              status === "Belum Lunas" ? "bg-rose-500 text-white shadow-xs font-semibold" : "text-slate-500 hover:text-slate-900"
            }`}
          >
            Belum Lunas
          </button>
        </div>

        {/* Reimbursement Filter Pill */}
        {onReimbursementChange && (
          <button
            type="button"
            onClick={() => onReimbursementChange(isReimbursement ? null : true)}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
              isReimbursement
                ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            <span>🏷️</span>
            <span>Talangan</span>
            {isReimbursement && (
              <span className="bg-white/20 text-[10px] px-1 rounded-full">Aktif</span>
            )}
          </button>
        )}

        {/* Reset button */}
        {(selectedCategory || search || status || isReimbursement) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-8 px-2 text-xs text-slate-400 hover:text-slate-700 gap-1 ml-auto"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </Button>
        )}
      </div>
    </div>
  );
};
