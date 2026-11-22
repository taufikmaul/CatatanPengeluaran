import { api } from "@/lib/api";
import type {
  AiChatModelCatalog,
  AiChatProviderId,
  AiChatSessionDetail,
  AiChatSessionSummary,
  AiChatToolTrace,
} from "@/types";

export type AiChatStreamEvent =
  | { type: "tool_start"; data: { tool: string; label: string; arguments?: Record<string, unknown> } }
  | { type: "tool_end"; data: AiChatToolTrace }
  | { type: "delta"; data: { text: string } }
  | {
      type: "done";
      data: {
        session_id: number;
        message_id: number;
        title: string;
        provider: AiChatProviderId | string;
        model_used: string;
        tool_calls: AiChatToolTrace[];
      };
    }
  | { type: "error"; data: { message: string } };

function getCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function getAiChatModels(): Promise<AiChatModelCatalog> {
  const res = await api.get("/ai-chat/models");
  return res.data;
}

export async function listAiChatSessions(limit = 50): Promise<AiChatSessionSummary[]> {
  const res = await api.get("/ai-chat/sessions", { params: { limit } });
  return res.data?.sessions ?? [];
}

export async function createAiChatSession(payload?: {
  title?: string;
  provider?: string;
  model_id?: string;
}): Promise<AiChatSessionSummary> {
  const res = await api.post("/ai-chat/sessions", payload || {});
  return res.data.session;
}

export async function getAiChatSession(sessionId: number): Promise<AiChatSessionDetail> {
  const res = await api.get(`/ai-chat/sessions/${sessionId}`);
  return res.data.session;
}

export async function updateAiChatSession(
  sessionId: number,
  payload: { title?: string; provider?: string; model_id?: string }
): Promise<AiChatSessionSummary> {
  const res = await api.patch(`/ai-chat/sessions/${sessionId}`, payload);
  return res.data.session;
}

export async function deleteAiChatSession(sessionId: number): Promise<void> {
  await api.delete(`/ai-chat/sessions/${sessionId}`);
}

export function extractSseFrames(buffer: string): {
  events: AiChatStreamEvent[];
  rest: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: AiChatStreamEvent[] = [];

  for (const frame of parts) {
    if (!frame.trim()) continue;
    let eventName = "message";
    const dataLines: string[] = [];

    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join("\n"));
      if (
        eventName === "tool_start" ||
        eventName === "tool_end" ||
        eventName === "delta" ||
        eventName === "done" ||
        eventName === "error"
      ) {
        events.push({ type: eventName, data: parsed } as AiChatStreamEvent);
      }
    } catch {
      // Abaikan frame malformed tanpa memutus stream
    }
  }

  return { events, rest };
}

export async function streamAiChatMessage(params: {
  sessionId: number;
  content: string;
  provider?: string;
  modelId?: string;
  signal?: AbortSignal;
  onEvent: (event: AiChatStreamEvent) => void;
}): Promise<void> {
  const { sessionId, content, provider, modelId, signal, onEvent } = params;
  const csrfToken = getCookieValue("catpen_csrf");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetch(`/api/v1/ai-chat/sessions/${sessionId}/messages/stream`, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify({
      content,
      provider: provider || undefined,
      model_id: modelId || undefined,
    }),
    signal,
  });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent("catpen:unauthorized"));
    throw new Error("Sesi login telah berakhir. Silakan login kembali.");
  }

  if (!response.ok) {
    let detail = `Gagal memproses permintaan (HTTP ${response.status}).`;
    try {
      const errJson = await response.json();
      if (typeof errJson?.detail === "string" && errJson.detail.trim()) {
        detail = errJson.detail.trim();
      }
    } catch {
      // Abaikan jika respons bukan JSON
    }
    throw new Error(detail);
  }

  if (!response.body) {
    throw new Error("Browser tidak mendukung pembacaan streaming SSE.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = extractSseFrames(buffer);
      buffer = rest;
      for (const ev of events) {
        onEvent(ev);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const { events } = extractSseFrames(buffer + "\n\n");
      for (const ev of events) {
        onEvent(ev);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
