/**
 * frontend/src/lib/telegram.ts
 * Helper utility untuk parsing, memvalidasi, dan menampilkan tautan chat Telegram
 */

export interface TelegramLinkInfo {
  raw: string;
  url: string | null;
  isUrl: boolean;
  isTelegram: boolean;
  sourceType: "telegram_msg" | "telegram_private" | "web" | "csv" | "other";
  displayText: string;
  badgeLabel: string;
  details?: {
    topicId?: string;
    messageId?: string;
    chatIdentifier?: string;
  };
}

/**
 * Parsing link atau string sumber transaksi untuk keperluan cross check
 */
export function parseTelegramLink(msgLink?: string | null): TelegramLinkInfo {
  const raw = (msgLink || "").trim();

  if (!raw || raw === "-" || raw.toLowerCase() === "none" || raw.toLowerCase() === "null") {
    return {
      raw: "",
      url: null,
      isUrl: false,
      isTelegram: false,
      sourceType: "other",
      displayText: "Tidak ada link",
      badgeLabel: "-",
    };
  }

  const isHttp = /^https?:\/\//i.test(raw);
  const isTgScheme = /^tg:\/\//i.test(raw);

  if (isHttp || isTgScheme) {
    const isTelegramUrl = /t\.me|telegram\.me|tg:\/\//i.test(raw);

    // Parsing struktur link t.me/c/clean_id/[thread_id]/msg_id
    let topicId: string | undefined;
    let messageId: string | undefined;
    let chatIdentifier: string | undefined;

    const tmeMatch = raw.match(/t\.me\/c\/([a-zA-Z0-9_-]+)(?:\/(\d+))?(?:\/(\d+))?/i);
    if (tmeMatch) {
      chatIdentifier = tmeMatch[1];
      if (tmeMatch[3]) {
        topicId = tmeMatch[2];
        messageId = tmeMatch[3];
      } else if (tmeMatch[2]) {
        messageId = tmeMatch[2];
      }
    } else {
      const publicMatch = raw.match(/t\.me\/([a-zA-Z0-9_]+)\/(\d+)/i);
      if (publicMatch) {
        chatIdentifier = publicMatch[1];
        messageId = publicMatch[2];
      }
    }

    let badgeLabel = "Chat Telegram";
    if (topicId && messageId) {
      badgeLabel = `Topik #${topicId} • Pesan #${messageId}`;
    } else if (messageId) {
      badgeLabel = `Pesan #${messageId}`;
    }

    return {
      raw,
      url: raw,
      isUrl: true,
      isTelegram: isTelegramUrl,
      sourceType: isTelegramUrl ? "telegram_msg" : "other",
      displayText: raw,
      badgeLabel,
      details: {
        topicId,
        messageId,
        chatIdentifier,
      },
    };
  }

  const lower = raw.toLowerCase();
  if (lower.includes("private") && lower.includes("chat")) {
    return {
      raw,
      url: null,
      isUrl: false,
      isTelegram: true,
      sourceType: "telegram_private",
      displayText: "Private Chat Telegram",
      badgeLabel: "Private Chat",
    };
  }

  if (lower.includes("web") || lower.includes("dashboard")) {
    return {
      raw,
      url: null,
      isUrl: false,
      isTelegram: false,
      sourceType: "web",
      displayText: "Web Dashboard",
      badgeLabel: "Web",
    };
  }

  if (lower.includes("csv") || lower.includes("import")) {
    return {
      raw,
      url: null,
      isUrl: false,
      isTelegram: false,
      sourceType: "csv",
      displayText: "Import CSV",
      badgeLabel: "CSV",
    };
  }

  return {
    raw,
    url: null,
    isUrl: false,
    isTelegram: false,
    sourceType: "other",
    displayText: raw,
    badgeLabel: raw,
  };
}

/**
 * Helper untuk menyalin link ke clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback lama
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textArea);
    return success;
  } catch {
    return false;
  }
}
