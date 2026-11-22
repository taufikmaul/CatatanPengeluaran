import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { AiChatPanel } from "@/components/ai-chat/AiChatPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  deleteAiChatSession,
  listAiChatSessions,
  updateAiChatSession,
} from "@/lib/aiChatApi";
import { cn } from "@/lib/utils";
import type { AiChatSessionSummary } from "@/types";

export interface AiChatFullPageProps {
  sessionId: number | null;
  onSessionChange: (sessionId: number | null) => void;
  onNavigateConfig: () => void;
}

export function AiChatFullPage({
  sessionId,
  onSessionChange,
  onNavigateConfig,
}: AiChatFullPageProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const {
    data: sessions = [],
    isLoading: isSessionsLoading,
    isError: isSessionsError,
    refetch: refetchSessions,
  } = useQuery<AiChatSessionSummary[]>({
    queryKey: ["ai-chat-sessions"],
    queryFn: () => listAiChatSessions(80),
  });

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.last_message_preview || "").toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  const handleSaveRename = async (id: number) => {
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setEditingSessionId(null);
      return;
    }
    try {
      await updateAiChatSession(id, { title: trimmed });
      queryClient.invalidateQueries({ queryKey: ["ai-chat-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["ai-chat-session", id] });
    } finally {
      setEditingSessionId(null);
    }
  };

  const handleDeleteSession = async (id: number) => {
    try {
      await deleteAiChatSession(id);
      if (sessionId === id) {
        onSessionChange(null);
      }
      queryClient.invalidateQueries({ queryKey: ["ai-chat-sessions"] });
    } finally {
      setConfirmDeleteId(null);
    }
  };

  const renderSidebarContent = () => (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 p-3.5">
        <span className="text-xs font-semibold text-foreground">Riwayat Percakapan</span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            onClick={() => {
              onSessionChange(null);
              setIsMobileHistoryOpen(false);
            }}
            className="h-9 gap-1.5 px-3 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Baru
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => setIsMobileHistoryOpen(false)}
            aria-label="Tutup daftar riwayat"
            className="h-9 w-9 md:hidden"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="p-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari topik chat..."
            className="h-9 pl-8 text-xs rounded-xl"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
        {isSessionsLoading && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Spinner className="h-4 w-4 text-primary" />
            <span>Memuat sesi...</span>
          </div>
        )}

        {isSessionsError && !isSessionsLoading && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs space-y-2">
            <p className="text-foreground font-medium">Gagal memuat riwayat sesi.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => refetchSessions()}
              className="h-8 text-xs"
            >
              Coba Lagi
            </Button>
          </div>
        )}

        {!isSessionsLoading && !isSessionsError && filteredSessions.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground px-2">
            {searchQuery.trim()
              ? "Tidak ada sesi yang cocok dengan kata kunci."
              : "Belum ada riwayat percakapan. Mulai pertanyaan pertama Anda di sebelah kanan."}
          </p>
        )}

        {filteredSessions.map((s) => {
          const isActive = s.id === sessionId;
          const isEditing = editingSessionId === s.id;
          const isConfirming = confirmDeleteId === s.id;

          return (
            <div
              key={s.id}
              className={cn(
                "group rounded-xl border p-2.5 text-xs transition-colors",
                isActive
                  ? "border-primary/40 bg-primary/10"
                  : "border-border/70 bg-background hover:bg-muted/60"
              )}
            >
              {isEditing ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveRename(s.id);
                  }}
                  className="flex items-center gap-1"
                >
                  <Input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    autoFocus
                    className="h-8 flex-1 text-xs"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    variant="ghost"
                    aria-label="Simpan judul"
                    className="h-8 w-8 shrink-0 text-emerald-600"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Batal ubah judul"
                    onClick={() => setEditingSessionId(null)}
                    className="h-8 w-8 shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onSessionChange(s.id);
                      setIsMobileHistoryOpen(false);
                    }}
                    className="min-w-0 flex-1 text-left space-y-0.5"
                  >
                    <p className="truncate font-semibold text-foreground">{s.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {s.provider === "sumopod" ? "Sumopod" : "ClassAI"} / {s.model_id || "default"}
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
                    <div className="flex shrink-0 items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Ubah judul ${s.title}`}
                        onClick={() => {
                          setEditingSessionId(s.id);
                          setEditingTitle(s.title);
                        }}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Hapus sesi ${s.title}`}
                        onClick={() => setConfirmDeleteId(s.id)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="relative flex h-[calc(100vh-8.5rem)] min-h-[540px] w-full overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      {/* Sidebar desktop */}
      <aside className="hidden w-72 shrink-0 border-r border-border md:block">
        {renderSidebarContent()}
      </aside>

      {/* Drawer riwayat mobile */}
      {isMobileHistoryOpen && (
        <div className="absolute inset-0 z-30 flex md:hidden">
          <div className="h-full w-72 max-w-[85vw] border-r border-border bg-card shadow-xl">
            {renderSidebarContent()}
          </div>
          <button
            type="button"
            aria-label="Tutup overlay riwayat"
            onClick={() => setIsMobileHistoryOpen(false)}
            className="flex-1 bg-black/40"
          />
        </div>
      )}

      {/* Canvas chat utama (blocks-so/ai-05 full width) */}
      <div className="flex min-w-0 flex-1 flex-col">
        <AiChatPanel
          sessionId={sessionId}
          onSessionChange={onSessionChange}
          variant="full"
          onToggleHistory={() => setIsMobileHistoryOpen((v) => !v)}
          onNavigateConfig={onNavigateConfig}
        />
      </div>
    </div>
  );
}
