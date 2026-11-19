// Thin wrapper around the Telegram WebApp SDK (loaded from telegram.org in the root layout).

type Haptic = {
  impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred: (type: "success" | "error" | "warning") => void;
  selectionChanged: () => void;
};

type BackButton = {
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
};

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { language_code?: string } };
  colorScheme: "light" | "dark";
  platform: string;
  version: string;
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
  onEvent: (event: string, cb: () => void) => void;
  offEvent: (event: string, cb: () => void) => void;
  openLink: (url: string) => void;
  openTelegramLink: (url: string) => void;
  isVersionAtLeast: (v: string) => boolean;
  HapticFeedback: Haptic;
  BackButton: BackButton;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function tg(): TelegramWebApp | undefined {
  if (typeof window === "undefined") return undefined;
  return window.Telegram?.WebApp;
}

/** True when running inside a Telegram client (initData is only present there). */
export function inTelegram(): boolean {
  return !!tg()?.initData;
}

export const haptic = {
  light() {
    try {
      tg()?.HapticFeedback.impactOccurred("light");
    } catch {}
  },
  success() {
    try {
      tg()?.HapticFeedback.notificationOccurred("success");
    } catch {}
  },
  error() {
    try {
      tg()?.HapticFeedback.notificationOccurred("error");
    } catch {}
  },
};

export function openLink(url: string) {
  const w = tg();
  if (inTelegram() && w) w.openLink(url);
  else window.open(url, "_blank", "noopener");
}

export function openTelegramLink(url: string) {
  const w = tg();
  if (inTelegram() && w) w.openTelegramLink(url);
  else window.open(url, "_blank", "noopener");
}

export function shareUrl(link: string, text: string) {
  openTelegramLink(
    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
  );
}

/** Applies the theme from Telegram (or the OS outside Telegram) and syncs Telegram chrome colours. */
export function applyTheme() {
  const w = tg();
  const scheme =
    w && w.initData
      ? w.colorScheme
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = scheme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  if (w && w.initData && bg) {
    try {
      w.setHeaderColor(bg);
      w.setBackgroundColor(bg);
    } catch {}
  }
  return scheme;
}

// Back button stack: the top-most sub-screen or sheet owns Telegram's BackButton.
const backStack: Array<() => void> = [];
let backBound = false;

function onBackClick() {
  const top = backStack[backStack.length - 1];
  if (top) top();
}

export function pushBack(handler: () => void): () => void {
  const w = tg();
  backStack.push(handler);
  if (w && w.initData) {
    if (!backBound) {
      w.BackButton.onClick(onBackClick);
      backBound = true;
    }
    w.BackButton.show();
  }
  return () => {
    const i = backStack.lastIndexOf(handler);
    if (i >= 0) backStack.splice(i, 1);
    if (w && w.initData && backStack.length === 0) w.BackButton.hide();
  };
}
