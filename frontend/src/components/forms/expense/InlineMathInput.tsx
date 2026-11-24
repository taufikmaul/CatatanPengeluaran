import React, { useState, useEffect } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { parseMathExpression } from "@/lib/mathExpression";
import { formatRupiah } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface InlineMathInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "prefix"> {
  value: number;
  onChange: (val: number) => void;
  formatCurrencyHint?: boolean;
  /** Optional text prefix inside ReUI InputGroupAddon (e.g. "Rp") */
  prefixText?: string;
  /** Optional text suffix or ReactNode inside ReUI InputGroupAddon (e.g. "%" or action button) */
  suffixAddon?: React.ReactNode;
  inputClassName?: string;
}

export const InlineMathInput: React.FC<InlineMathInputProps> = ({
  value,
  onChange,
  formatCurrencyHint = true,
  prefixText,
  suffixAddon,
  className,
  inputClassName,
  placeholder,
  disabled,
  ...props
}) => {
  const [text, setText] = useState<string>(value > 0 ? String(value) : "");
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(value > 0 ? String(value) : "");
    }
  }, [value, isFocused]);

  const hasExpression = /[+\-*/xXkjt:]/.test(text);
  const evaluated = hasExpression ? parseMathExpression(text) : null;

  const handleCommit = () => {
    const res = parseMathExpression(text);
    if (res !== null && !isNaN(res)) {
      onChange(res);
      setText(res > 0 ? String(res) : "");
    } else if (text.trim() === "") {
      onChange(0);
      setText("");
    } else {
      setText(value > 0 ? String(value) : "");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCommit();
      (e.target as HTMLInputElement).blur();
    }
  };

  const resolvedPrefix =
    prefixText !== undefined ? prefixText : formatCurrencyHint ? "Rp" : "";

  const showEvalPreview =
    isFocused && evaluated !== null && evaluated !== Number(text);

  return (
    <InputGroup
      data-disabled={disabled ? "true" : undefined}
      className={cn("h-9 bg-background", className)}
    >
      {resolvedPrefix && (
        <InputGroupAddon align="inline-start" className="pl-2.5 pr-1">
          <InputGroupText className="text-xs font-medium text-muted-foreground">
            {resolvedPrefix}
          </InputGroupText>
        </InputGroupAddon>
      )}

      <InputGroupInput
        type="text"
        inputMode="text"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          handleCommit();
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          "h-full text-xs tabular-nums",
          resolvedPrefix && "pl-1.5",
          (showEvalPreview || suffixAddon) && "pr-1.5",
          inputClassName
        )}
        {...props}
      />

      {showEvalPreview ? (
        <InputGroupAddon align="inline-end" className="pr-2.5 pl-1">
          <InputGroupText className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
            = {formatCurrencyHint ? formatRupiah(evaluated) : evaluated}
          </InputGroupText>
        </InputGroupAddon>
      ) : suffixAddon ? (
        <InputGroupAddon align="inline-end" className="pr-2 pl-1">
          {suffixAddon}
        </InputGroupAddon>
      ) : null}
    </InputGroup>
  );
};
