import { Expense } from "@/types";

export function isPaidStatus(status?: string | null): boolean {
  return (status || "").trim().toLowerCase() === "lunas";
}

export function isDpStatus(status?: string | null): boolean {
  const st = (status || "").trim().toLowerCase();
  return st.includes("dp") || st.includes("sebagian") || st.includes("partial");
}

export function isUnpaidOrDpStatus(status?: string | null): boolean {
  if (isPaidStatus(status)) return false;
  const st = (status || "").trim().toLowerCase();
  return (
    st.includes("belum") ||
    st.includes("hutang") ||
    st.includes("tempo") ||
    st.includes("dp") ||
    st.includes("sebagian") ||
    st.includes("partial")
  );
}

export function getExpensePaymentBreakdown(expense: Pick<Expense, "total_price" | "paid_amount" | "remaining_amount" | "pay_status">) {
  const total = Math.max(0, Number(expense.total_price || 0));
  const paidFlag = isPaidStatus(expense.pay_status);
  if (paidFlag) {
    return {
      total,
      paid: total,
      remaining: 0,
      progressPct: total > 0 ? 100 : 0,
      isPaid: true,
      isDp: false,
    };
  }
  const paid = Math.min(total, Math.max(0, Number(expense.paid_amount || 0)));
  const remaining =
    expense.remaining_amount !== undefined && expense.remaining_amount !== null
      ? Math.max(0, Number(expense.remaining_amount))
      : Math.max(0, total - paid);
  const progressPct = total > 0 ? Math.min(100, Math.round((paid / total) * 1000) / 10) : 0;
  const dp = isDpStatus(expense.pay_status) || (paid > 0 && remaining > 0);
  return {
    total,
    paid,
    remaining,
    progressPct,
    isPaid: false,
    isDp: dp,
  };
}

export interface DueUrgencyInfo {
  daysLeft: number | null;
  label: string;
  badgeClass: string;
  urgency: "overdue" | "today" | "soon" | "upcoming" | "none";
}

export function getDueUrgencyInfo(dueStr?: string | null): DueUrgencyInfo {
  if (!dueStr || dueStr === "-" || dueStr.trim() === "") {
    return {
      daysLeft: null,
      label: "Tanpa Tempo",
      badgeClass:
        "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      urgency: "none",
    };
  }

  let targetDate: Date | null = null;
  const isoMatch = dueStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    targetDate = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  } else {
    const slashMatch = dueStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (slashMatch) {
      targetDate = new Date(Number(slashMatch[3]), Number(slashMatch[2]) - 1, Number(slashMatch[1]));
    } else {
      const parsed = new Date(dueStr);
      if (!isNaN(parsed.getTime())) targetDate = parsed;
    }
  }

  if (!targetDate) {
    return {
      daysLeft: null,
      label: dueStr,
      badgeClass:
        "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
      urgency: "none",
    };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return {
      daysLeft: diffDays,
      label: `Lewat ${absDays} Hari`,
      badgeClass:
        "bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800 font-bold",
      urgency: "overdue",
    };
  }
  if (diffDays === 0) {
    return {
      daysLeft: 0,
      label: "Jatuh Tempo Hari Ini",
      badgeClass: "bg-amber-700 text-white border-amber-800 font-bold",
      urgency: "today",
    };
  }
  if (diffDays <= 7) {
    return {
      daysLeft: diffDays,
      label: `${diffDays} Hari Lagi`,
      badgeClass:
        "bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800 font-semibold",
      urgency: "soon",
    };
  }
  return {
    daysLeft: diffDays,
    label: `${diffDays} Hari Lagi`,
    badgeClass:
      "bg-slate-50 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 font-medium",
    urgency: "upcoming",
  };
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getTempoQuickDate(days: number, baseDateStr?: string | null): string {
  const base =
    baseDateStr && /^\d{4}-\d{2}-\d{2}/.test(baseDateStr)
      ? new Date(
          Number(baseDateStr.slice(0, 4)),
          Number(baseDateStr.slice(5, 7)) - 1,
          Number(baseDateStr.slice(8, 10))
        )
      : new Date();
  base.setDate(base.getDate() + days);
  return toIsoDate(base);
}

export function getEndOfMonthDate(baseDateStr?: string | null): string {
  const base =
    baseDateStr && /^\d{4}-\d{2}-\d{2}/.test(baseDateStr)
      ? new Date(
          Number(baseDateStr.slice(0, 4)),
          Number(baseDateStr.slice(5, 7)) - 1,
          Number(baseDateStr.slice(8, 10))
        )
      : new Date();
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return toIsoDate(lastDay);
}
