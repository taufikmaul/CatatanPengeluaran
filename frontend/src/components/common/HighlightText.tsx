import React, { createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import {
  MIN_SEARCH_LENGTH,
  getEffectiveSearchQuery,
  highlightTextParts,
  isSearchTooShort,
} from "@/lib/searchHighlight";

const SearchHighlightContext = createContext<string>("");

export interface SearchHighlightProviderProps {
  query?: string | null;
  minLength?: number;
  children: React.ReactNode;
}

export const SearchHighlightProvider: React.FC<SearchHighlightProviderProps> = ({
  query,
  minLength = MIN_SEARCH_LENGTH,
  children,
}) => {
  const effective = getEffectiveSearchQuery(query, minLength);
  return (
    <SearchHighlightContext.Provider value={effective}>
      {children}
    </SearchHighlightContext.Provider>
  );
};

export function useSearchHighlight(): string {
  return useContext(SearchHighlightContext);
}

export const DEFAULT_HIGHLIGHT_MARK_CLASS =
  "bg-amber-200/90 text-slate-950 dark:bg-amber-400/35 dark:text-amber-100 rounded-[2px] px-0.5 font-semibold not-italic";

export interface HighlightTextProps {
  text: string | number | null | undefined;
  query?: string | null;
  minLength?: number;
  className?: string;
  markClassName?: string;
}

/**
 * Merender teks dengan highlight keyword pencarian (minimal 2 karakter).
 * Jika query belum diisi melalui prop, membaca dari SearchHighlightContext.
 */
export const HighlightText: React.FC<HighlightTextProps> = ({
  text,
  query,
  minLength = MIN_SEARCH_LENGTH,
  className,
  markClassName,
}) => {
  const contextQuery = useSearchHighlight();
  const resolvedQuery = query !== undefined ? query : contextQuery;

  if (text === null || text === undefined) return null;
  const str = String(text);
  const segments = highlightTextParts(str, resolvedQuery, minLength);

  if (segments.length <= 1 && !segments[0]?.match) {
    return className ? <span className={className}>{str}</span> : <>{str}</>;
  }

  const content = segments.map((seg, idx) =>
    seg.match ? (
      <mark key={idx} className={cn(DEFAULT_HIGHLIGHT_MARK_CLASS, markClassName)}>
        {seg.text}
      </mark>
    ) : (
      <React.Fragment key={idx}>{seg.text}</React.Fragment>
    )
  );

  return className ? <span className={className}>{content}</span> : <>{content}</>;
};

const SKIP_HIGHLIGHT_TAGS = new Set([
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polygon",
  "polyline",
  "ellipse",
  "g",
  "defs",
  "use",
  "input",
  "textarea",
  "select",
  "option",
  "mark",
  "script",
  "style",
  "kbd",
]);

/**
 * Menelusuri ReactNode secara aman untuk menambahkan highlight keyword pada teks di dalamnya.
 * Mempertahankan struktur komponen dan referensi jika tidak ada kecocokan.
 */
export function highlightReactNode(
  node: React.ReactNode,
  query: string | null | undefined,
  minLength: number = MIN_SEARCH_LENGTH
): React.ReactNode {
  const effective = getEffectiveSearchQuery(query, minLength);
  if (!effective) return node;
  if (node === null || node === undefined || typeof node === "boolean") {
    return node;
  }

  if (typeof node === "string" || typeof node === "number") {
    const str = String(node);
    const segments = highlightTextParts(str, effective, minLength);
    if (segments.length <= 1 && !segments[0]?.match) {
      return node;
    }
    return (
      <>
        {segments.map((seg, idx) =>
          seg.match ? (
            <mark key={idx} className={DEFAULT_HIGHLIGHT_MARK_CLASS}>
              {seg.text}
            </mark>
          ) : (
            <React.Fragment key={idx}>{seg.text}</React.Fragment>
          )
        )}
      </>
    );
  }

  if (Array.isArray(node)) {
    let changed = false;
    const mapped = node.map((child, idx) => {
      const next = highlightReactNode(child, effective, minLength);
      if (next !== child) {
        changed = true;
        if (React.isValidElement(next) && next.key === null) {
          return React.cloneElement(next, { key: idx });
        }
      }
      return next;
    });
    return changed ? mapped : node;
  }

  if (React.isValidElement(node)) {
    if (node.type === HighlightText || node.type === SearchMinCharHint) {
      return node;
    }
    if (typeof node.type === "string" && SKIP_HIGHLIGHT_TAGS.has(node.type)) {
      return node;
    }
    const props = node.props as {
      children?: React.ReactNode;
      "data-no-highlight"?: boolean | string;
    };
    if (props?.["data-no-highlight"]) {
      return node;
    }
    if (
      props?.children !== undefined &&
      props?.children !== null &&
      typeof props.children !== "function"
    ) {
      const nextChildren = highlightReactNode(props.children, effective, minLength);
      if (nextChildren !== props.children) {
        return React.cloneElement(node, undefined, nextChildren);
      }
    }
    return node;
  }

  return node;
}

export interface SearchMinCharHintProps {
  query: string | null | undefined;
  minLength?: number;
  className?: string;
  message?: string;
}

/**
 * Menampilkan petunjuk ringkas bila keyword baru 1 karakter (di bawah batas minimum pencarian).
 */
export const SearchMinCharHint: React.FC<SearchMinCharHintProps> = ({
  query,
  minLength = MIN_SEARCH_LENGTH,
  className,
  message,
}) => {
  if (!isSearchTooShort(query, minLength)) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "text-[11px] font-medium text-amber-700 dark:text-amber-300 mt-1 leading-tight",
        className
      )}
    >
      {message || `Ketik minimal ${minLength} karakter untuk mencari`}
    </p>
  );
};
