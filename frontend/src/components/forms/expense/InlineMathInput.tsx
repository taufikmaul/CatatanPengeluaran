import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { parseMathExpression } from "@/lib/mathExpression";
import { formatRupiah } from "@/lib/formatters";
import { Calculator } from "lucide-react";

interface InlineMathInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: number;
  onChange: (val: number) => void;
  formatCurrencyHint?: boolean;
}

export const InlineMathInput: React.FC<InlineMathInputProps> = ({
  value,
  onChange,
  formatCurrencyHint = true,
  className,
  placeholder,
  ...props
}) => {
  const [text, setText] = useState<string>(value > 0 ? String(value) : "");
  const [isFocused, setIsFocused] = useState(false);

  // Sinkronisasi saat value prop berubah dari luar (misal autofill / reset)
  useEffect(() => {
    if (!isFocused) {
      setText(value > 0 ? String(value) : "");
    }
  }, [value, isFocused]);

  // Cek apakah ada ekspresi matematika dalam teks
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
      // Jika tidak valid, kembalikan ke nilai sebelumnya
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

  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          handleCommit();
        }}
        onKeyDown={handleKeyDown}
        className={className}
        {...props}
      />

      {/* Floating preview badge saat pengguna mengetik ekspresi matematika */}
      {isFocused && evaluated !== null && evaluated !== Number(text) && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-600 text-white text-[11px] font-bold shadow-md animate-in fade-in zoom-in-95 pointer-events-none">
          <Calculator className="w-3 h-3" />
          <span>= {formatCurrencyHint ? formatRupiah(evaluated) : evaluated}</span>
        </div>
      )}
    </div>
  );
};
