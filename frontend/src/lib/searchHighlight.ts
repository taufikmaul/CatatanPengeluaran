export const MIN_SEARCH_LENGTH = 2;

/**
 * Mengembalikan query pencarian yang telah di-trim hanya jika memenuhi panjang minimum.
 * Mengembalikan string kosong jika panjang < minLength.
 */
export function getEffectiveSearchQuery(
  rawQuery: string | null | undefined,
  minLength: number = MIN_SEARCH_LENGTH
): string {
  const trimmed = (rawQuery ?? "").trim();
  if (trimmed.length < minLength) return "";
  return trimmed;
}

/**
 * True jika pengguna sudah mengetik karakter non-spasi namun belum mencapai batas minimum.
 */
export function isSearchTooShort(
  rawQuery: string | null | undefined,
  minLength: number = MIN_SEARCH_LENGTH
): boolean {
  const trimmed = (rawQuery ?? "").trim();
  return trimmed.length > 0 && trimmed.length < minLength;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mengekstrak token keyword untuk highlight (frasa utuh + kata per kata untuk multi-kata),
 * diurutkan dari terpanjang agar kecocokan frasa utuh diprioritaskan.
 */
export function extractSearchTokens(
  rawQuery: string | null | undefined,
  minLength: number = MIN_SEARCH_LENGTH
): string[] {
  const effective = getEffectiveSearchQuery(rawQuery, minLength);
  if (!effective) return [];

  const seen = new Set<string>();
  const tokens: string[] = [];

  const pushToken = (token: string) => {
    const clean = token.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(clean);
    }
  };

  pushToken(effective);

  const words = effective.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    for (const w of words) {
      pushToken(w);
    }
  }

  return tokens.sort((a, b) => b.length - a.length);
}

/**
 * Membangun RegExp global case-insensitive untuk mencocokkan keyword pencarian.
 */
export function buildHighlightRegex(
  rawQuery: string | null | undefined,
  minLength: number = MIN_SEARCH_LENGTH
): RegExp | null {
  const tokens = extractSearchTokens(rawQuery, minLength);
  if (tokens.length === 0) return null;
  const pattern = tokens.map(escapeRegExp).join("|");
  return new RegExp(`(${pattern})`, "gi");
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Memecah teks menjadi segmen cocok dan tidak cocok untuk rendering highlight.
 */
export function highlightTextParts(
  text: string,
  rawQuery: string | null | undefined,
  minLength: number = MIN_SEARCH_LENGTH
): HighlightSegment[] {
  if (!text) return [];
  const regex = buildHighlightRegex(rawQuery, minLength);
  if (!regex) return [{ text, match: false }];

  const parts = text.split(regex);
  if (parts.length <= 1) return [{ text, match: false }];

  const tokenSet = new Set(
    extractSearchTokens(rawQuery, minLength).map((t) => t.toLowerCase())
  );

  const segments: HighlightSegment[] = [];
  for (const part of parts) {
    if (!part) continue;
    segments.push({
      text: part,
      match: tokenSet.has(part.toLowerCase()),
    });
  }
  return segments;
}
