import React, { createContext, useContext, useEffect, useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

interface PromptInputContextValue {
  submitForm: () => void;
}

const PromptInputContext = createContext<PromptInputContextValue | null>(null);

export interface PromptInputProps
  extends Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> {
  onSubmit: (message: { text: string }) => void;
  children: React.ReactNode;
}

export function PromptInput({
  onSubmit,
  className,
  children,
  ...props
}: PromptInputProps) {
  const formRef = useRef<HTMLFormElement>(null);

  const submitForm = () => {
    if (!formRef.current) return;
    const textarea = formRef.current.querySelector("textarea");
    const text = textarea ? textarea.value : "";
    onSubmit({ text });
  };

  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submitForm();
  };

  return (
    <PromptInputContext.Provider value={{ submitForm }}>
      <form
        ref={formRef}
        onSubmit={handleFormSubmit}
        className={cn("w-full", className)}
        {...props}
      >
        <div
          data-slot="input-group"
          className="flex flex-col rounded-xl border border-border bg-muted/40 transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring/20"
        >
          {children}
        </div>
      </form>
    </PromptInputContext.Provider>
  );
}

export interface PromptInputTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
}

export function PromptInputTextarea({
  className,
  value,
  onKeyDown,
  ...props
}: PromptInputTextareaProps) {
  const ctx = useContext(PromptInputContext);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, 144);
    el.style.height = `${Math.max(40, nextHeight)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ctx?.submitForm();
    }
  };

  return (
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      onKeyDown={handleKeyDown}
      className={cn(
        "w-full resize-none bg-transparent px-3.5 pt-3 pb-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
}

export function PromptInputFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function PromptInputTools({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-1.5 min-w-0 flex-1", className)} {...props}>
      {children}
    </div>
  );
}

export function PromptInputButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn("h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground", className)}
      {...props}
    >
      {children}
    </Button>
  );
}

export interface PromptInputSubmitProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  status?: ChatStatus;
  onStop?: () => void;
}

export function PromptInputSubmit({
  status = "ready",
  onStop,
  disabled,
  className,
  ...props
}: PromptInputSubmitProps) {
  const isBusy = status === "submitted" || status === "streaming";

  if (isBusy && onStop) {
    return (
      <Button
        type="button"
        size="icon"
        variant="destructive"
        aria-label="Hentikan jawaban"
        title="Hentikan jawaban"
        onClick={onStop}
        className={cn("h-9 w-9 shrink-0 rounded-full", className)}
      >
        <Square className="h-3.5 w-3.5 fill-current" />
      </Button>
    );
  }

  return (
    <Button
      type="submit"
      size="icon"
      disabled={disabled || isBusy}
      aria-label="Kirim pesan"
      title="Kirim pesan"
      className={cn(
        "h-9 w-9 shrink-0 rounded-full transition-[transform,opacity] active:scale-[0.96]",
        className
      )}
      {...props}
    >
      <ArrowUp className="h-4 w-4" />
    </Button>
  );
}
