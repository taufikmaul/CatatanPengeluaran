import React, { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, RotateCcw, Plus, Filter, Tag, ShieldAlert, Sparkles } from "lucide-react";
import { ExpenseUser } from "@/types";
import { Filters } from "@/components/reui/filters/filters";
import type { FilterField, FilterQuery, FilterNode } from "@/components/reui/filters/filters-types";
import { createFilterQuery, createFilterRule, isFilterRule } from "@/components/reui/filters/filters-query";

interface FilterBarProps {
  month: number;
  year: number;
  selectedCategory: string;
  search: string;
  status: string;
  payMethod?: string;
  payMethods?: string[];
  isReimbursement?: boolean | null;
  users?: ExpenseUser[];
  selectedUserId?: number | null;
  categories: string[];
  onMonthChange: (month: number) => void;
  onYearChange: (year: number) => void;
  onCategoryChange: (category: string) => void;
  onSearchChange: (search: string) => void;
  onStatusChange: (status: string) => void;
  onPayMethodChange?: (payMethod: string) => void;
  onReimbursementChange?: (val: boolean | null) => void;
  onUserChange?: (userId: number | null) => void;
  onReset: () => void;
  onOpenAddExpense: () => void;
  onOpenAuditDuplicates?: () => void;
  onOpenDataHygiene?: () => void;
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
  payMethod = "",
  payMethods = [],
  isReimbursement,
  users = [],
  selectedUserId,
  categories,
  onMonthChange,
  onYearChange,
  onCategoryChange,
  onSearchChange,
  onStatusChange,
  onPayMethodChange,
  onReimbursementChange,
  onUserChange,
  onReset,
  onOpenAddExpense,
  onOpenAuditDuplicates,
  onOpenDataHygiene,
}) => {
  // ReUI Filter Fields schema
  const filterFields: FilterField[] = useMemo(() => [
    {
      id: "category",
      label: "Kategori",
      type: "select",
      options: categories.map((c) => ({ label: c, value: c })),
    },
    {
      id: "status",
      label: "Status Pembayaran",
      type: "select",
      options: [
        { label: "Lunas", value: "Lunas" },
        { label: "Belum Lunas", value: "Belum Lunas" },
      ],
    },
    {
      id: "pay_method",
      label: "Metode Bayar",
      type: "select",
      options: (payMethods && payMethods.length > 0 ? payMethods : [
        "Tunai", "Transfer", "QRIS", "Debit", "Kredit", "COD"
      ]).map((pm) => ({ label: pm, value: pm })),
    },
    {
      id: "user",
      label: "Penginput",
      type: "select",
      options: users.map((u) => ({ label: u.name, value: String(u.id) })),
    },
    {
      id: "month",
      label: "Bulan",
      type: "select",
      options: MONTH_NAMES.map((m, idx) => ({ label: m, value: String(idx + 1) })),
    },
    {
      id: "year",
      label: "Tahun",
      type: "select",
      options: [2024, 2025, 2026, 2027].map((y) => ({ label: String(y), value: String(y) })),
    },
    {
      id: "is_reimbursement",
      label: "Talangan (Reimburse)",
      type: "select",
      options: [
        { label: "Ya (Talangan)", value: "true" },
        { label: "Tidak (Bukan Talangan)", value: "false" },
      ],
    },
  ], [categories, users, payMethods]);

  // Build active FilterQuery tree from state
  const filterQuery: FilterQuery = useMemo(() => {
    const rules: ReturnType<typeof createFilterRule>[] = [];
    if (selectedCategory) {
      rules.push(createFilterRule({ id: "rule-cat", path: ["category"], operator: "is", value: selectedCategory }));
    }
    if (status) {
      rules.push(createFilterRule({ id: "rule-status", path: ["status"], operator: "is", value: status }));
    }
    if (payMethod) {
      rules.push(createFilterRule({ id: "rule-pay-method", path: ["pay_method"], operator: "is", value: payMethod }));
    }
    if (selectedUserId !== null && selectedUserId !== undefined) {
      rules.push(createFilterRule({ id: "rule-user", path: ["user"], operator: "is", value: String(selectedUserId) }));
    }
    if (month) {
      rules.push(createFilterRule({ id: "rule-month", path: ["month"], operator: "is", value: String(month) }));
    }
    if (year) {
      rules.push(createFilterRule({ id: "rule-year", path: ["year"], operator: "is", value: String(year) }));
    }
    if (isReimbursement !== null && isReimbursement !== undefined) {
      rules.push(createFilterRule({ id: "rule-reimb", path: ["is_reimbursement"], operator: "is", value: isReimbursement ? "true" : "false" }));
    }
    return createFilterQuery(rules, "and");
  }, [selectedCategory, status, payMethod, selectedUserId, month, year, isReimbursement]);

  // Handle updates from ReUI Filters popover
  const handleQueryChange = (nextQuery: FilterQuery) => {
    let newCategory = "";
    let newStatus = "";
    let newPayMethod = "";
    let newUserId: number | null = null;
    let newMonth = month;
    let newYear = year;
    let newReimbursement: boolean | null = null;

    const traverse = (nodes: FilterNode[]) => {
      for (const node of nodes) {
        if (isFilterRule(node)) {
          const fieldId = node.path[0];
          const val = String(node.value ?? "");
          if (fieldId === "category") newCategory = val;
          if (fieldId === "status") newStatus = val;
          if (fieldId === "pay_method") newPayMethod = val;
          if (fieldId === "user") newUserId = val ? Number(val) : null;
          if (fieldId === "month") newMonth = Number(val) || month;
          if (fieldId === "year") newYear = Number(val) || year;
          if (fieldId === "is_reimbursement") newReimbursement = val === "true" ? true : val === "false" ? false : null;
        } else if (node.rules) {
          traverse(node.rules);
        }
      }
    };

    if (nextQuery?.rules) {
      traverse(nextQuery.rules);
    }

    if (newCategory !== selectedCategory) onCategoryChange(newCategory);
    if (newStatus !== status) onStatusChange(newStatus);
    if (newPayMethod !== (payMethod || "") && onPayMethodChange) onPayMethodChange(newPayMethod);
    if (newUserId !== selectedUserId && onUserChange) onUserChange(newUserId);
    if (newMonth !== month) onMonthChange(newMonth);
    if (newYear !== year) onYearChange(newYear);
    if (newReimbursement !== isReimbursement && onReimbursementChange) onReimbursementChange(newReimbursement);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="Cari nama barang, supplier, invoice, penginput..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 pr-4 h-10 rounded-xl bg-slate-50/50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-900 text-sm"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* ReUI Advanced Filters Popover */}
          <Filters
            variant="advanced"
            advancedMode="popover"
            advancedAlign="end"
            reorderable
            fields={filterFields}
            query={filterQuery}
            onQueryChange={handleQueryChange}
            className="[--filter-field-width:9rem] [--filter-operator-width:6.5rem] [--filter-value-width:11rem]"
          />

          {onOpenDataHygiene && (
            <Button
              type="button"
              variant="outline"
              onClick={onOpenDataHygiene}
              className="rounded-xl shadow-xs gap-1.5 h-10 font-medium px-3 text-xs border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
              title="Cek kesehatan & rapikan data transaksi secara otomatis"
            >
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>Rapikan Data</span>
            </Button>
          )}

          {onOpenAuditDuplicates && (
            <Button
              type="button"
              variant="outline"
              onClick={onOpenAuditDuplicates}
              className="rounded-xl shadow-xs gap-1.5 h-10 font-medium px-3 text-xs border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
            >
              <ShieldAlert className="w-4 h-4 text-amber-600" />
              <span>Audit Duplikat</span>
            </Button>
          )}

          {/* Add Expense Action Button */}
          <Button
            onClick={onOpenAddExpense}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm gap-2 h-10 font-semibold px-4 shrink-0"
          >
            <Plus className="w-4 h-4" />
            Tambah Catatan
          </Button>
        </div>
      </div>

      {/* Quick Filter Selectors Row */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-1.5 text-xs text-slate-500 mr-1">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter Cepat:</span>
        </div>

        {/* Month Selector */}
        <select
          value={month}
          onChange={(e) => onMonthChange(Number(e.target.value))}
          className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
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
          className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
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
          className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer max-w-[140px] truncate"
        >
          <option value="">Semua Kategori</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        {/* Payment Method Dropdown */}
        {onPayMethodChange && (
          <select
            value={payMethod || ""}
            onChange={(e) => onPayMethodChange(e.target.value)}
            className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer max-w-[140px] truncate"
            title="Filter Metode Bayar"
          >
            <option value="">Semua Metode</option>
            {(payMethods && payMethods.length > 0 ? payMethods : [
              "Tunai", "Transfer", "QRIS", "Debit", "Kredit", "COD"
            ]).map((pm) => (
              <option key={pm} value={pm}>
                {pm}
              </option>
            ))}
          </select>
        )}

        {/* User Filter Dropdown */}
        {users && users.length > 0 && (
          <select
            value={selectedUserId !== null && selectedUserId !== undefined ? String(selectedUserId) : ""}
            onChange={(e) => onUserChange?.(e.target.value ? Number(e.target.value) : null)}
            className="h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer max-w-[150px] truncate"
          >
            <option value="">Semua Penginput</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}

        {/* Status Pills */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg ml-auto md:ml-0">
          <button
            onClick={() => onStatusChange("")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              status === "" ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs font-semibold" : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            Semua
          </button>
          <button
            onClick={() => onStatusChange("Lunas")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              status === "Lunas" ? "bg-emerald-500 text-white shadow-xs font-semibold" : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            Lunas
          </button>
          <button
            onClick={() => onStatusChange("Belum Lunas")}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-all ${
              status === "Belum Lunas" ? "bg-rose-500 text-white shadow-xs font-semibold" : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
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
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50"
            }`}
          >
            <Tag className="w-3.5 h-3.5 shrink-0" />
            <span>Talangan</span>
            {isReimbursement && (
              <span className="bg-white/20 text-[10px] px-1 rounded-full">Aktif</span>
            )}
          </button>
        )}

        {/* Reset button */}
        {(selectedCategory || search || status || isReimbursement || payMethod) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-8 px-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 gap-1 ml-auto"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </Button>
        )}
      </div>
    </div>
  );
};
