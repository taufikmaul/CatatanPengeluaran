import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { AiChatPanel } from "@/components/ai-chat/AiChatPanel";
import { deleteAiChatSession, listAiChatSessions } from "@/lib/aiChatApi";
import { cn } from "@/lib/utils";
import type { AiChatSessionSummary } from "@/types";

export interface AiChatWidgetProps {
  sessionId: number | null;
  onSessionChange: (sessionId: number | null) => void;
  onExpandFull: () => void;
  onNavigateConfig: () => void;
  hidden?: boolean;
}

export function AiChatWidget({
  sessionId,
  onSessionChange,
  onExpandFull,
  onNavigateConfig,
  hidden = false,
}: AiChatWidgetProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { data: sessions = [], isLoading: isSessionsLoading } = useQuery<AiChatSessionSummary[]>({
    queryKey: ["ai-chat-sessions"],
    queryFn: () => listAiChatSessions(30),
    enabled: isOpen && isHistoryOpen,
  });

  // Tutup popup dengan tombol Escape (aksesibilitas keyboard R-32)
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isHistoryOpen) {
          setIsHistoryOpen(false);
        } else {
          setIsOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, isHistoryOpen]);

  if (hidden) return null;

  const handleDeleteSession = async (id: number) => {
    try {
      await deleteAiChatSession(id);
      if (sessionId === id) {
        onSessionChange(null);
      }
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["ai-chat-sessions"] });
    } catch {
      setConfirmDeleteId(null);
    }
  };

  return (
    <>
      {!isOpen && (
        <Button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Buka Asisten Keuangan AI"
          className="fixed bottom-5 right-5 z-40 h-11 gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          <MessageSquareText className="h-4 w-4" />
          <span>Tanya AI</span>
        </Button>
      )}

      {isOpen && (
        <div
          role="dialog"
          aria-label="Asisten Keuangan AI"
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-card",
            "inset-0 rounded-none",
            "sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[600px] sm:max-h-[calc(100vh-2.5rem)] sm:w-[420px] sm:max-w-[calc(100vw-2rem)] sm:rounded-3xl",
            "sm:shadow-[0_0_0_1px_oklch(0_0_0/0.06),0_1px_2px_oklch(0_0_0/0.04),0_12px_32px_-12px_oklch(0_0_0/0.18)]",
            "dark:sm:shadow-[0_0_0_1px_oklch(1_0_0/0.1),0_12px_32px_-12px_oklch(0_0_0/0.6)]"
          )}
        >
          <div className="relative flex h-full w-full flex-col overflow-hidden">
            <AiChatPanel
              sessionId={sessionId}
              onSessionChange={onSessionChange}
              variant="popup"
              isHistoryOpen={isHistoryOpen}
              onToggleHistory={() => setIsHistoryOpen((v) => !v)}
              onExpandFull={() => {
                setIsOpen(false);
                setIsHistoryOpen(false);
                onExpandFull();
              }}
              onClosePopup={() => {
                setIsOpen(false);
                setIsHistoryOpen(false);
              }}
              onNavigateConfig={() => {
                setIsOpen(false);
                onNavigateConfig();
              }}
            />

            {/* Overlay daftar riwayat sesi di dalam popup */}
            {isHistoryOpen && (
              <div className="absolute inset-x-0 bottom-0 top-[57px] z-20 flex flex-col bg-card/98 backdrop-blur-sm">
                <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                  <span className="text-xs font-semibold text-foreground">
                    Riwayat Percakapan
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onSessionChange(null);
                      setIsHistoryOpen(false);
                    }}
                    className="h-8 gap-1 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Sesi Baru
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                  {isSessionsLoading && (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                      <Spinner className="h-4 w-4 text-primary" />
                      <span>Memuat riwayat...</span>
                    </div>
                  )}

                  {!isSessionsLoading && sessions.length === 0 && (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      Belum ada riwayat percakapan tersimpan. Mulai pertanyaan baru untuk menyimpan sesi.
                    </p>
                  )}

                  {sessions.map((s) => {
                    const isActive = s.id === sessionId;
                    const isConfirming = confirmDeleteId === s.id;
                    return (
                      <div
                        key={s.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs transition-colors",
                          isActive
                            ? "border-primary/40 bg-primary/10 text-foreground"
                            : "border-border/70 bg-background hover:bg-muted/60"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSessionChange(s.id);
                            setIsHistoryOpen(false);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate font-medium text-foreground">{s.title}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {s.provider === "sumopod" ? "Sumopod" : "ClassAI"} / {s.model_id || "default"} ({s.message_count} pesan)
                          </p>
                        </button>

                        {isConfirming ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => handleDeleteSession(s.id)}
                              className="h-7 px-2 text-[11px]"
                            >
                              Hapus
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDeleteId(null)}
                              className="h-7 px-2 text-[11px]"
                            >
                              Batal
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Hapus sesi ${s.title}`}
                            onClick={() => setConfirmDeleteId(s.id)}
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
