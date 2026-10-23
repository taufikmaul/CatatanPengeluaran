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
