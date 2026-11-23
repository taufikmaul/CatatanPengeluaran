"use client";

import React, { ReactNode, useMemo } from "react";
import {
  DataGrid,
  dataGridFeatures,
  type DataGridFeatures,
  type DataGridProps,
  type DataGridTableInstance,
} from "@/components/reui/data-grid/data-grid";
import { DataGridTable } from "@/components/reui/data-grid/data-grid-table";
import {
  DataGridPagination,
  type DataGridPaginationProps,
} from "@/components/reui/data-grid/data-grid-pagination";
import { DataGridScrollArea } from "@/components/reui/data-grid/data-grid-scroll-area";
import { type DataGridI18nOverrides } from "@/components/reui/data-grid/data-grid-i18n";
import { ColumnDef, Row, useTable } from "@tanstack/react-table";
import { cn } from "@/lib/utils";

const DEFAULT_I18N: DataGridI18nOverrides = {
  labels: {
    loading: "Memuat data...",
    empty: "Tidak ada data",
    rowsPerPage: "Baris per halaman",
    paginationInfo: ({ from, to, count }) => `${from}–${to} dari ${count}`,
    previousPage: "Halaman sebelumnya",
    nextPage: "Halaman berikutnya",
    goToPage: (page) => `Ke halaman ${page}`,
  },
};

const DEFAULT_PAGE_SIZES = [10, 20, 25, 50, 100];

export interface DataTableBaseProps<TData extends object> {
  /** Status loading */
  isLoading?: boolean;
  /** Mode loading (skeleton / spinner) */
  loadingMode?: "skeleton" | "spinner";
  /** Tinggi / styling scroll area (e.g., 'max-h-[260px]' atau 'min-h-[300px]') */
  scrollAreaClassName?: string;
  /** Custom wrapper styling pada container kartu */
  containerClassName?: string;
  /** Custom styling pada wrapper table desktop (misal 'hidden md:block') */
  tableWrapperClassName?: string;
  /** Custom styling pada header container */
  headerClassName?: string;
  /** Footer container styling */
  footerClassName?: string;
  /** Apakah pagination ditampilkan (default: true) */
  showPagination?: boolean;
  /** Custom options untuk pagination (sizes, labels, etc.) */
  paginationProps?: Partial<DataGridPaginationProps>;
  /** Header/Toolbar tambahan di atas table */
  header?: ReactNode;
  /** Konten tambahan di dalam card (misal Mobile Card View `block md:hidden`) */
  children?: ReactNode;
  /** Custom empty state jika data kosong & tidak sedang loading */
  emptyState?: ReactNode;
  /** Callback klik baris */
  onRowClick?: (row: TData) => void;
  /** Table layout overrides */
  tableLayout?: DataGridProps<DataGridFeatures, TData>["tableLayout"];
  /** Override label i18n */
  i18n?: DataGridI18nOverrides;
  /** Pesan kosong default */
  emptyMessage?: ReactNode | string;
}

export interface DataTableControlledProps<TData extends object>
  extends DataTableBaseProps<TData> {
  /** Table instance dari useTable() TanStack / ReUI */
  table: DataGridTableInstance<TData>;
  /** Total data record count (wajib untuk server-side pagination) */
  recordCount: number;
  columns?: never;
  data?: never;
  defaultPageSize?: never;
  getRowId?: never;
  getRowCanExpand?: never;
}

export interface DataTableAutoProps<TData extends object>
  extends DataTableBaseProps<TData> {
  table?: never;
  /** Definisi kolom TanStack/ReUI */
  columns: ColumnDef<DataGridFeatures, TData>[];
  /** Data array untuk client-side pagination & sorting */
  data: TData[];
  /** Total record count (opsional, default data.length) */
  recordCount?: number;
  /** Jumlah baris per halaman awal (default: 10) */
  defaultPageSize?: number;
  /** Fungsi ekstraksi ID unik per baris */
  getRowId?: (originalRow: TData, index: number) => string;
  /** Menentukan apakah baris bisa di-expand (untuk detail row) */
  getRowCanExpand?: (row: Row<DataGridFeatures, TData>) => boolean;
}

export type DataTableProps<TData extends object> =
  | DataTableControlledProps<TData>
  | DataTableAutoProps<TData>;

function DataTableCore<TData extends object>({
  table,
  recordCount,
  isLoading = false,
  loadingMode = "skeleton",
  scrollAreaClassName,
  containerClassName,
  tableWrapperClassName,
  headerClassName,
  footerClassName,
  showPagination = true,
  paginationProps,
  header,
  children,
  emptyState,
  onRowClick,
  tableLayout = { columnsResizable: true },
  i18n,
  emptyMessage,
}: DataTableBaseProps<TData> & {
  table: DataGridTableInstance<TData>;
  recordCount: number;
}) {
  const currentPageSize = table.state.pagination?.pageSize ?? 10;

  const resolvedSizes = useMemo(() => {
    const base = paginationProps?.sizes ?? DEFAULT_PAGE_SIZES;
    if (base.includes(currentPageSize)) return base;
    return [...base, currentPageSize].sort((a, b) => a - b);
  }, [paginationProps?.sizes, currentPageSize]);

  const mergedI18n = useMemo<DataGridI18nOverrides>(
    () => ({
      labels: {
        ...DEFAULT_I18N.labels,
        ...i18n?.labels,
      },
    }),
    [i18n]
  );

  const isEmpty = !isLoading && recordCount === 0;

  return (
    <DataGrid
      table={table}
      recordCount={recordCount}
      isLoading={isLoading}
      loadingMode={loadingMode}
      onRowClick={onRowClick}
      tableLayout={tableLayout}
      i18n={mergedI18n}
      emptyMessage={emptyMessage}
    >
      <div
        className={cn(
          "w-full rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs flex flex-col",
          containerClassName
        )}
      >
        {header && (
          <div
            className={cn(
              "border-b border-slate-100 dark:border-slate-800 p-4",
              headerClassName
            )}
          >
            {header}
          </div>
        )}

        {isEmpty && emptyState ? (
          emptyState
        ) : (
          <>
            <div className={tableWrapperClassName}>
              <DataGridScrollArea className={scrollAreaClassName}>
                <DataGridTable />
              </DataGridScrollArea>
            </div>
            {children}
          </>
        )}

        {showPagination && (!isEmpty || isLoading) && (
          <div
            className={cn(
              "border-t border-slate-100 dark:border-slate-800 px-4 py-2.5 bg-slate-50/50 dark:bg-slate-900/50",
              footerClassName
            )}
          >
            <DataGridPagination {...paginationProps} sizes={resolvedSizes} />
          </div>
        )}
      </div>
    </DataGrid>
  );
}

function DataTableAuto<TData extends object>(props: DataTableAutoProps<TData>) {
  const {
    columns,
    data,
    recordCount,
    defaultPageSize = 10,
    getRowId,
    getRowCanExpand,
    ...rest
  } = props;

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data,
    getRowId,
    getRowCanExpand,
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: defaultPageSize,
      },
    },
  });

  return (
    <DataTableCore
      {...rest}
      table={table}
      recordCount={recordCount ?? data.length}
    />
  );
}

/**
 * Komponen DataTable tergeneralisasi untuk semua data grid tabel di aplikasi.
 * Mendukung 2 mode:
 * 1. Controlled (`table` + `recordCount`) untuk server-side pagination / state eksternal.
 * 2. Declarative (`columns` + `data`) untuk client-side pagination & sorting otomatis.
 * Terintegrasi penuh dengan ReUI DataGrid, ScrollArea, dan DataGridPagination (display per page & navigasi halaman).
 */
export function DataTable<TData extends object>(props: DataTableProps<TData>) {
  if ("table" in props && props.table) {
    return <DataTableCore {...props} />;
  }
  return <DataTableAuto {...(props as DataTableAutoProps<TData>)} />;
}

export default DataTable;
