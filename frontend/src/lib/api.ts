import axios from "axios";
import { ExpenseFormData } from "@/types";

export const api = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// Request interceptor to attach SSO token if available
api.interceptors.request.use((config) => {
  const token =
    localStorage.getItem("hcteams_token") ||
    localStorage.getItem("dashboard_session_token");
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to catch 401 unauthorized
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Dispatch custom event for auth modal or redirect
      window.dispatchEvent(new CustomEvent("catpen:unauthorized"));
    }
    return Promise.reject(error);
  }
);

export async function scanExpenseOcr(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await api.post("/expenses/ocr", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
}

export async function createExpenseBatch(items: ExpenseFormData[]) {
  const res = await api.post("/expenses/batch", { items });
  return res.data;
}

export async function getAiAnalysis(month?: number, year?: number, forceRefresh = false) {
  const params = new URLSearchParams();
  if (month) params.append("month", String(month));
  if (year) params.append("year", String(year));
  if (forceRefresh) params.append("force_refresh", "true");
  const res = await api.get(`/reports/ai-analysis?${params.toString()}`);
  return res.data;
}

export async function getExpenseUsers() {
  const res = await api.get("/expenses/users/list");
  return res.data;
}

export async function getMonthlyBudget(year?: number, month?: number) {
  const params = new URLSearchParams();
  if (year) params.append("year", String(year));
  if (month) params.append("month", String(month));
  const res = await api.get(`/budgets?${params.toString()}`);
  return res.data;
}

export async function saveMonthlyBudget(payload: {
  year: number;
  month: number;
  total_budget: number;
  category_percentages: Record<string, number>;
}) {
  const res = await api.post("/budgets", payload);
  return res.data;
}

export async function copyMonthlyBudget(
  targetYear: number,
  targetMonth: number,
  sourceYear?: number,
  sourceMonth?: number
) {
  const res = await api.post("/budgets/copy", {
    target_year: targetYear,
    target_month: targetMonth,
    source_year: sourceYear,
    source_month: sourceMonth,
  });
  return res.data;
}

