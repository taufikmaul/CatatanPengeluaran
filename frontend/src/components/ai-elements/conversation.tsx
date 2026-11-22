import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConversationContextValue {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  isAtBottom: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
}

const ConversationContext = createContext<ConversationContextValue | null>(null);

export interface ConversationProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Conversation({ className, children, ...props }: ConversationProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= 56;
    isAtBottomRef.current = nearBottom;
    setIsAtBottom(nearBottom);
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  // Auto-scroll ke bawah saat konten bertambah jika pengguna masih di bagian bawah
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [children]);

  return (
    <ConversationContext.Provider value={{ scrollRef, isAtBottom, scrollToBottom }}>
      <div className={cn("relative flex-1 min-h-0 overflow-hidden", className)} {...props}>
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full w-full overflow-y-auto scroll-smooth"
        >
          {children}
        </div>
      </div>
    </ConversationContext.Provider>
  );
}

export function ConversationContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-5 px-4 py-4 sm:px-5 sm:py-5", className)} {...props}>
      {children}
    </div>
  );
}

export function ConversationScrollButton({
  className,
}: {
  className?: string;
}) {
  const ctx = useContext(ConversationContext);
  if (!ctx || ctx.isAtBottom) return null;

  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      aria-label="Gulir ke pesan terbaru"
      title="Gulir ke pesan terbaru"
      onClick={() => ctx.scrollToBottom("smooth")}
      className={cn(
        "absolute bottom-3 left-1/2 -translate-x-1/2 z-10 h-9 w-9 rounded-full border-border bg-background/95 shadow-md hover:bg-muted",
        className
      )}
    >
      <ChevronDown className="h-4 w-4 text-foreground" />
    </Button>
  );
}
