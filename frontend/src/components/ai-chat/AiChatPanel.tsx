import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  History,
  Maximize2,
  PanelLeft,
  Plus,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  type ChatStatus,
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  createAiChatSession,
  getAiChatModels,
  getAiChatSession,
  streamAiChatMessage,
  updateAiChatSession,
} from "@/lib/aiChatApi";
import { cn } from "@/lib/utils";
import type {
  AiChatMessage,
  AiChatModelCatalog,
  AiChatProviderId,
  AiChatToolTrace,
} from "@/types";

const QUICK_SUGGESTIONS = [
  "Ringkasan pengeluaran & budget bulan ini",
  "Tagihan belum lunas & talangan karyawan",
  "Saldo rekening & arus kas minggu ini",
  "Bahan apa yang harganya naik bulan ini?",
];

interface LiveToolState {
  tool: string;
  label: string;
  period?: string;
  status: "running" | "success" | "warning" | "error";
  summary?: string;
}

export interface AiChatPanelProps {
  sessionId: number | null;
  onSessionChange: (sessionId: number | null) => void;
  variant?: "popup" | "full";
  onExpandFull?: () => void;
  onClosePopup?: () => void;
  onToggleHistory?: () => void;
  isHistoryOpen?: boolean;
  onNavigateConfig?: () => void;
  className?: string;
}

export function AiChatPanel({
  sessionId,
  onSessionChange,
  variant = "popup",
  onExpandFull,
  onClosePopup,
  onToggleHistory,
  isHistoryOpen = false,
  onNavigateConfig,
  className,
}: AiChatPanelProps) {
  const queryClient = useQueryClient();
  const [inputValue, setInputValue] = useState("");
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [localMessages, setLocalMessages] = useState<AiChatMessage[]>([]);
  const [liveTools, setLiveTools] = useState<LiveToolState[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);

  const [selectedProvider, setSelectedProvider] = useState<AiChatProviderId>("openrouter");
  const [selectedModel, setSelectedModel] = useState<string>("");

  const abortRef = useRef<AbortController | null>(null);
  const streamingSessionRef = useRef<number | null>(null);

  const {
    data: modelsCatalog,
    isLoading: isModelsLoading,
    isError: isModelsError,
    refetch: refetchModels,
  } = useQuery<AiChatModelCatalog>({
    queryKey: ["ai-chat-models"],
    queryFn: getAiChatModels,
    staleTime: 60_000,
  });

  const {
    data: sessionDetail,
    isLoading: isSessionLoading,
    isError: isSessionError,
    refetch: refetchSession,
  } = useQuery({
    queryKey: ["ai-chat-session", sessionId],
    queryFn: () => getAiChatSession(sessionId!),
    enabled: sessionId !== null,
    staleTime: 10_000,
  });

  // Sinkronkan provider & model default saat katalog atau sesi berubah (kecuali sedang streaming)
  useEffect(() => {
    if (status === "submitted" || status === "streaming") return;

    if (sessionDetail) {
      const prov = sessionDetail.provider === "sumopod" ? "sumopod" : "openrouter";
      setSelectedProvider(prov);
      if (sessionDetail.model_id) {
        setSelectedModel(sessionDetail.model_id);
        return;
      }
    }

    if (modelsCatalog) {
      setSelectedProvider(modelsCatalog.default_provider || "openrouter");
      setSelectedModel(modelsCatalog.default_model || "");
    }
  }, [modelsCatalog, sessionDetail, status]);

  // Sinkronkan daftar pesan dari server saat tidak sedang streaming aktif pada sesi ini
  useEffect(() => {
    if (status === "submitted" || status === "streaming") return;
    if (sessionId === null) {
      setLocalMessages([]);
      setLiveTools([]);
      setErrorMessage(null);
      return;
    }
    if (sessionDetail) {
      setLocalMessages(sessionDetail.messages || []);
      setErrorMessage(null);
    }
  }, [sessionId, sessionDetail, status]);

  // Batalkan stream yang menggantung jika komponen unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const hasAnyConfiguredProvider = useMemo(() => {
    if (!modelsCatalog) return true;
    return modelsCatalog.providers.some((p) => p.configured);
  }, [modelsCatalog]);

  const activeProviderMeta = useMemo(() => {
    return modelsCatalog?.providers.find((p) => p.id === selectedProvider);
  }, [modelsCatalog, selectedProvider]);

  const modelSelectValue = useMemo(() => {
    if (!selectedModel) return "";
    return `${selectedProvider}::${selectedModel}`;
  }, [selectedProvider, selectedModel]);

  const handleModelSelectionChange = (encodedValue: string) => {
    const sepIdx = encodedValue.indexOf("::");
    if (sepIdx === -1) return;
    const nextProv = encodedValue.slice(0, sepIdx) === "sumopod" ? "sumopod" : "openrouter";
    const nextModel = encodedValue.slice(sepIdx + 2);
    setSelectedProvider(nextProv);
    setSelectedModel(nextModel);

    if (sessionId !== null) {
      updateAiChatSession(sessionId, {
        provider: nextProv,
        model_id: nextModel,
      })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["ai-chat-sessions"] });
        })
        .catch(() => {
          // Abaikan jika gagal update preferensi sesi pasif
        });
    }
  };

  const handleNewChat = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus("ready");
    setLocalMessages([]);
    setLiveTools([]);
    setErrorMessage(null);
    setLastFailedPrompt(null);
    onSessionChange(null);
  };

  const handleStopStreaming = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus("ready");
    setLiveTools([]);
    if (streamingSessionRef.current !== null) {
      queryClient.invalidateQueries({ queryKey: ["ai-chat-session", streamingSessionRef.current] });
      queryClient.invalidateQueries({ queryKey: ["ai-chat-sessions"] });
    }
  };

  const handleSend = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || status === "submitted" || status === "streaming") return;

    setErrorMessage(null);
    setLastFailedPrompt(null);
    setInputValue("");
    setStatus("submitted");
    setLiveTools([]);

    let targetSessionId = sessionId;
    try {
      if (targetSessionId === null) {
        const created = await createAiChatSession({
          provider: selectedProvider,
          model_id: selectedModel || undefined,
        });
        targetSessionId = created.id;
        onSessionChange(created.id);
        queryClient.invalidateQueries({ queryKey: ["ai-chat-sessions"] });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal membuat sesi percakapan baru.";
      setErrorMessage(msg);
      setLastFailedPrompt(text);
      setInputValue(text);
      setStatus("error");
      return;
    }

    streamingSessionRef.current = targetSessionId;
    const tempUserId = `temp-user-${Date.now()}`;
    const tempAssistantId = `temp-assistant-${Date.now()}`;

    const userMsg: AiChatMessage = {
      id: tempUserId,
      session_id: targetSessionId,
      role: "user",
      content: text,
      provider: selectedProvider,
      model_used: selectedModel,
    };
    const assistantMsg: AiChatMessage = {
      id: tempAssistantId,
      session_id: targetSessionId,
      role: "assistant",
      content: "",
      provider: selectedProvider,
      model_used: selectedModel,
      tool_calls: [],
    };

    setLocalMessages((prev) => [...prev, userMsg, assistantMsg]);

    const controller = new AbortController();
    abortRef.current = controller;
    let accumulatedContent = "";
    const completedTraces: AiChatToolTrace[] = [];

    try {
      await streamAiChatMessage({
        sessionId: targetSessionId,
        content: text,
        provider: selectedProvider,
        modelId: selectedModel || undefined,
        signal: controller.signal,
        onEvent: (ev) => {
          if (ev.type === "tool_start") {
            setStatus("streaming");
            setLiveTools((prev) => [
              ...prev,
              {
                tool: ev.data.tool,
                label: ev.data.label,
                status: "running",
              },
            ]);
          } else if (ev.type === "tool_end") {
            completedTraces.push(ev.data);
            setLiveTools((prev) => {
              const idx = prev.findIndex((t) => t.tool === ev.data.tool && t.status === "running");
              const updatedItem: LiveToolState = {
                tool: ev.data.tool,
                label: ev.data.label,
                period: ev.data.period,
                status:
                  ev.data.status === "error"
                    ? "error"
                    : ev.data.status === "warning"
                    ? "warning"
                    : "success",
                summary: ev.data.summary,
              };
              if (idx === -1) return [...prev, updatedItem];
              const clone = [...prev];
              clone[idx] = updatedItem;
              return clone;
            });
          } else if (ev.type === "delta") {
            setStatus("streaming");
            accumulatedContent += ev.data.text;
            const snapshotText = accumulatedContent;
            setLocalMessages((prev) =>
              prev.map((m) => (m.id === tempAssistantId ? { ...m, content: snapshotText } : m))
            );
          } else if (ev.type === "done") {
            const doneTraces = ev.data.tool_calls?.length ? ev.data.tool_calls : completedTraces;
            setLocalMessages((prev) =>
              prev.map((m) =>
                m.id === tempAssistantId
                  ? {
                      ...m,
                      id: ev.data.message_id,
                      provider: ev.data.provider,
                      model_used: ev.data.model_used,
                      tool_calls: doneTraces,
                    }
                  : m
              )
            );
            setLiveTools([]);
            setStatus("ready");
            queryClient.invalidateQueries({ queryKey: ["ai-chat-sessions"] });
            queryClient.invalidateQueries({ queryKey: ["ai-chat-session", targetSessionId] });
          } else if (ev.type === "error") {
            setErrorMessage(ev.data.message);
            setLastFailedPrompt(text);
            setStatus("error");
            setLiveTools([]);
            // Hapus placeholder kosong agar tidak meninggalkan bubble kosong
            setLocalMessages((prev) =>
              prev.filter((m) => !(m.id === tempAssistantId && !m.content.trim()))
            );
          }
        },
      });
      setStatus((prev) => (prev === "submitted" || prev === "streaming" ? "ready" : prev));
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setStatus("ready");
        setLiveTools([]);
        return;
      }
      const msg = err instanceof Error ? err.message : "Koneksi ke AI Chat terputus.";
      setErrorMessage(msg);
      setLastFailedPrompt(text);
      setStatus("error");
      setLiveTools([]);
      setLocalMessages((prev) =>
        prev.filter((m) => !(m.id === tempAssistantId && !m.content.trim()))
      );
    } finally {
      abortRef.current = null;
      streamingSessionRef.current = null;
    }
  };

  const isBusy = status === "submitted" || status === "streaming";
  const headerTitle = sessionDetail?.title || "Asisten Keuangan";

  const statusDotClass =
    status === "error" || !hasAnyConfiguredProvider
      ? "bg-rose-500"
      : isBusy
      ? "bg-amber-500"
      : "bg-emerald-500";

  const statusText = !hasAnyConfiguredProvider
    ? "API key belum diatur"
    : status === "submitted"
    ? "Menghubungkan model..."
    : status === "streaming"
    ? liveTools.some((t) => t.status === "running")
      ? "Mengambil data keuangan..."
      : "Menulis jawaban..."
    : status === "error"
    ? "Terjadi kendala"
    : `${selectedProvider === "openrouter" ? "OpenRouter" : "Sumopod"} siap`;

  return (
    <div className={cn("flex h-full w-full flex-col overflow-hidden bg-card text-card-foreground", className)}>
      {/* Header matching blocks-so/ai-05 */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-4 py-3 sm:px-5 sm:py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {variant === "full" && onToggleHistory && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onToggleHistory}
              aria-label="Daftar riwayat percakapan"
              title="Riwayat percakapan"
              className="h-9 w-9 shrink-0 md:hidden"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold leading-tight text-foreground">
              {headerTitle}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-1.5 shrink-0 rounded-full", statusDotClass)} />
              <span className="truncate">{statusText}</span>
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleNewChat}
            className="h-9 gap-1.5 px-2.5 text-xs"
            title="Mulai percakapan baru"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Chat Baru</span>
          </Button>

          {variant === "popup" && onToggleHistory && (
            <Button
              type="button"
              size="icon"
              variant={isHistoryOpen ? "secondary" : "ghost"}
              onClick={onToggleHistory}
              aria-label="Riwayat percakapan"
              title="Riwayat percakapan"
              className="h-9 w-9"
            >
              <History className="h-4 w-4" />
            </Button>
          )}

          {variant === "popup" && onExpandFull && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onExpandFull}
              aria-label="Buka layar penuh"
              title="Buka layar penuh"
              className="h-9 w-9"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}

          {variant === "popup" && onClosePopup && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onClosePopup}
              aria-label="Tutup popup chat"
              title="Tutup (Esc)"
              className="h-9 w-9"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      {/* Body Conversation */}
      <Conversation>
        <ConversationContent>
          {/* Loading state saat membuka sesi lama */}
          {sessionId !== null && isSessionLoading && localMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center">
              <Spinner className="h-6 w-6 text-primary" />
              <p className="text-xs text-muted-foreground">Memuat riwayat percakapan...</p>
            </div>
          )}

          {/* Error state saat gagal memuat sesi */}
          {sessionId !== null && isSessionError && !isSessionLoading && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-foreground space-y-2.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                <div>
                  <p className="font-semibold">Gagal memuat riwayat percakapan</p>
                  <p className="text-muted-foreground mt-0.5">
                    Periksa koneksi server atau coba muat ulang sesi ini.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => refetchSession()}
                className="h-8 gap-1.5 text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Muat Ulang
              </Button>
            </div>
          )}

          {/* Empty state saat belum ada pesan */}
          {!isSessionLoading && !isSessionError && localMessages.length === 0 && (
            <div className="mx-auto flex max-w-md flex-col items-start gap-3 py-4 text-left">
              <div className="space-y-1.5">
                <h2 className="text-sm font-semibold text-foreground">
                  Tanya Data Keuangan Historycake
                </h2>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Tanyakan pengeluaran, omzet, arus kas, saldo rekening, laba rugi, serapan
                  budget, tagihan jatuh tempo, talangan karyawan, tren harga bahan, HPP menu,
                  aset tetap, hingga pengajuan belanja. Angka diambil langsung dari database.
                </p>
              </div>

              {!hasAnyConfiguredProvider && !isModelsLoading && (
                <div className="w-full rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs space-y-2">
                  <p className="font-semibold text-foreground">
                    API Key OpenRouter atau Sumopod belum diisi
                  </p>
                  <p className="text-muted-foreground">
                    Lengkapi API key terlebih dahulu agar asisten dapat menjawab pertanyaan Anda.
                  </p>
                  {onNavigateConfig && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onNavigateConfig}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Buka Pengaturan AI
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Daftar Pesan */}
          {localMessages.map((message, index) => {
            const isLast = index === localMessages.length - 1;
            const traces = message.tool_calls || [];

            return (
              <Message from={message.role} key={message.id}>
                {message.role === "assistant" && traces.length > 0 && (
                  <details className="w-full rounded-xl border border-border/70 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-foreground/90">
                      <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>Data diperiksa ({traces.length} sumber)</span>
                    </summary>
                    <ul className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                      {traces.map((tr, tIdx) => (
                        <li key={`${tr.tool}-${tIdx}`} className="flex items-start gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                          <span>
                            <strong className="font-medium text-foreground">{tr.label}</strong>
                            {tr.period && tr.period !== "-" ? ` (${tr.period})` : ""}: {tr.summary}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* Indikator live tool saat streaming berlangsung */}
                {message.role === "assistant" && isLast && isBusy && liveTools.length > 0 && (
                  <div className="w-full space-y-1.5 rounded-xl border border-border/70 bg-muted/40 px-3 py-2.5 text-xs">
                    {liveTools.map((lt, idx) => (
                      <div key={`${lt.tool}-${idx}`} className="flex items-center gap-2">
                        {lt.status === "running" ? (
                          <Spinner className="h-3.5 w-3.5 shrink-0 text-primary" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                        <span className="text-foreground/90">
                          {lt.status === "running" ? `Mengambil ${lt.label.toLowerCase()}...` : lt.label}
                          {lt.period && lt.period !== "-" ? ` (${lt.period})` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <MessageContent>
                  {message.role === "assistant" ? (
                    message.content ? (
                      <MessageResponse>{message.content}</MessageResponse>
                    ) : isLast && isBusy ? (
                      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                        <Spinner className="h-3.5 w-3.5 text-primary" />
                        <span>
                          {status === "submitted"
                            ? "Menghubungkan ke model AI..."
                            : "Menyusun jawaban dari data..."}
                        </span>
                      </div>
                    ) : null
                  ) : (
                    <p className="whitespace-pre-wrap text-pretty">{message.content}</p>
                  )}
                </MessageContent>

                {message.role === "assistant" && message.model_used && message.content && !isLast && (
                  <span className="text-[11px] text-muted-foreground">
                    {message.provider === "sumopod" ? "Sumopod" : "OpenRouter"} / {message.model_used}
                  </span>
                )}
              </Message>
            );
          })}

          {/* Error banner jika stream gagal */}
          {errorMessage && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-3.5 text-xs space-y-2.5">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-foreground">Gagal mendapatkan jawaban</p>
                  <p className="text-muted-foreground">{errorMessage}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {lastFailedPrompt && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleSend(lastFailedPrompt)}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Coba Lagi
                  </Button>
                )}
                {onNavigateConfig && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onNavigateConfig}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Pengaturan AI
                  </Button>
                )}
              </div>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Footer: Quick chips + PromptInput + Model Selector */}
      <div className="flex shrink-0 flex-col gap-2.5 border-t border-border/60 bg-card p-3">
        {localMessages.length === 0 && !isBusy && (
          <div className="flex flex-wrap gap-1.5 px-0.5">
            {QUICK_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={isBusy}
                onClick={() => handleSend(suggestion)}
                className="min-h-[34px] rounded-full border border-border bg-background px-3 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <PromptInput onSubmit={(msg) => handleSend(msg.text)}>
          <PromptInputTextarea
            value={inputValue}
            onChange={(e) => setInputValue(e.currentTarget.value)}
            placeholder="Tanya pengeluaran, saldo bank, laba rugi, harga bahan..."
            disabled={isBusy}
          />
          <PromptInputFooter>
            <PromptInputTools>
              {isModelsError ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => refetchModels()}
                  className="h-8 px-2 text-xs text-destructive"
                >
                  Muat ulang model
                </Button>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5">
                  <label htmlFor={`ai-chat-model-${variant}`} className="sr-only">
                    Pilih Provider dan Model AI
                  </label>
                  <select
                    id={`ai-chat-model-${variant}`}
                    value={modelSelectValue}
                    onChange={(e) => handleModelSelectionChange(e.target.value)}
                    disabled={isBusy || isModelsLoading}
                    aria-label="Pilih provider dan model AI"
                    className="h-9 max-w-[215px] sm:max-w-[260px] truncate rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  >
                    {modelsCatalog?.providers.map((prov) => (
                      <optgroup
                        key={prov.id}
                        label={`${prov.label}${prov.configured ? "" : " (Belum diatur)"}`}
                      >
                        {prov.models.map((m) => (
                          <option
                            key={`${prov.id}::${m}`}
                            value={`${prov.id}::${m}`}
                            disabled={!prov.configured}
                          >
                            {prov.label}: {m}
                            {!prov.configured ? " (API key kosong)" : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    {!modelsCatalog && (
                      <option value="openrouter::openai/gpt-4o-mini">Memuat model...</option>
                    )}
                  </select>
                </div>
              )}

              {activeProviderMeta && !activeProviderMeta.configured && (
                <span className="hidden sm:inline text-[11px] text-amber-600 dark:text-amber-400">
                  API key belum diatur
                </span>
              )}
            </PromptInputTools>

            <PromptInputSubmit
              status={status}
              onStop={handleStopStreaming}
              disabled={!inputValue.trim() && !isBusy}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
