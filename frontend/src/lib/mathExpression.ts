/**
 * Utility untuk mem-parse dan mengevaluasi ekspresi matematika sederhana
 * yang diketik oleh pengguna pada input harga atau qty (misal: "12 * 15k", "250000 / 4", "1.5jt").
 * Aman tanpa `eval()`.
 */

export function parseMathExpression(raw: string): number | null {
  if (!raw || typeof raw !== "string") return null;

  // Bersihkan format titik/koma ribuan jika murni angka terlebih dahulu
  let s = raw.trim().toLowerCase();

  // Ganti shorthand nilai Indonesia/umum:
  // "jt" / "m" -> * 1000000
  // "k" / "rb" -> * 1000
  // Contoh: 1.5jt -> 1500000, 15k -> 15000, 2.5k -> 2500
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:jt|m(?:io)?)\b/g, (_, n) => {
    const num = parseFloat(n.replace(",", "."));
    return String(Math.round(num * 1_000_000));
  });

  s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:k|rb)\b/g, (_, n) => {
    const num = parseFloat(n.replace(",", "."));
    return String(Math.round(num * 1_000));
  });

  // Ganti 'x' atau 'X' atau ':' menjadi '*' atau '/'
  s = s.replace(/x/g, "*").replace(/:/g, "/");

  // Jika input hanya mengandung angka dan titik desimal biasa
  // Hapus karakter selain digit, operator matematika, tanda kurung, dan titik desimal
  const sanitized = s.replace(/[^0-9+\-*/().]/g, "");
  if (!sanitized) return null;

  try {
    // Tokenizer sederhana
    const tokens: (number | string)[] = [];
    let currentNum = "";

    for (let i = 0; i < sanitized.length; i++) {
      const char = sanitized[i];
      if (/[0-9.]/.test(char)) {
        currentNum += char;
      } else if (["+", "-", "*", "/", "(", ")"].includes(char)) {
        if (currentNum) {
          const parsed = parseFloat(currentNum);
          if (isNaN(parsed)) return null;
          tokens.push(parsed);
          currentNum = "";
        }
        tokens.push(char);
      }
    }
    if (currentNum) {
      const parsed = parseFloat(currentNum);
      if (isNaN(parsed)) return null;
      tokens.push(parsed);
    }

    if (tokens.length === 0) return null;

    // Evaluator sederhana menggunakan Shunting-yard algorithm
    const outputQueue: (number | string)[] = [];
    const operatorStack: string[] = [];
    const precedence: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

    for (const token of tokens) {
      if (typeof token === "number") {
        outputQueue.push(token);
      } else if (["+", "-", "*", "/"].includes(token)) {
        while (
          operatorStack.length > 0 &&
          operatorStack[operatorStack.length - 1] !== "(" &&
          precedence[operatorStack[operatorStack.length - 1]] >= precedence[token]
        ) {
          outputQueue.push(operatorStack.pop()!);
        }
        operatorStack.push(token);
      } else if (token === "(") {
        operatorStack.push(token);
      } else if (token === ")") {
        while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== "(") {
          outputQueue.push(operatorStack.pop()!);
        }
        operatorStack.pop(); // buang '('
      }
    }

    while (operatorStack.length > 0) {
      const op = operatorStack.pop()!;
      if (op === "(" || op === ")") return null; // unclosed bracket
      outputQueue.push(op);
    }

    // Evaluasi Reverse Polish Notation
    const evalStack: number[] = [];
    for (const item of outputQueue) {
      if (typeof item === "number") {
        evalStack.push(item);
      } else {
        const b = evalStack.pop();
        const a = evalStack.pop();
        if (a === undefined || b === undefined) return null;
        let res = 0;
        if (item === "+") res = a + b;
        else if (item === "-") res = a - b;
        else if (item === "*") res = a * b;
        else if (item === "/") {
          if (b === 0) return null; // hindari division by zero
          res = a / b;
        }
        evalStack.push(res);
      }
    }

    if (evalStack.length !== 1) return null;
    const finalVal = evalStack[0];
    if (isNaN(finalVal) || !isFinite(finalVal)) return null;

    return Math.max(0, Math.round(finalVal * 100) / 100);
  } catch {
    return null;
  }
}
