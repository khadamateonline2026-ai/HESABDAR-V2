export const USED_IN_DOCS_MSG = "این مورد در اسناد استفاده شده و حذف نمی‌شود";

export type UsageFocus = {
  page: "purchase" | "sales" | "warehouses" | "opening";
  path: "/purchase" | "/sales" | "/warehouses" | "/finance/opening";
  invoiceId?: number;
  itemId?: number;
  orderId?: number;
  tab?: string;
  query?: string;
};

const KEY = "hesabdar-usage-focus";
const EVT = "hesabdar-usage-focus";

export function encodeUsageError(focus: UsageFocus): Error {
  return new Error(`${USED_IN_DOCS_MSG}\n${JSON.stringify(focus)}`);
}

export function parseUsageError(message: string): { text: string; focus: UsageFocus | null } {
  if (!message.includes(USED_IN_DOCS_MSG)) return { text: message, focus: null };
  const nl = message.indexOf("\n");
  if (nl < 0) return { text: USED_IN_DOCS_MSG, focus: null };
  try {
    const focus = JSON.parse(message.slice(nl + 1)) as UsageFocus;
    if (!focus || !focus.path) return { text: USED_IN_DOCS_MSG, focus: null };
    return { text: USED_IN_DOCS_MSG, focus };
  } catch {
    return { text: USED_IN_DOCS_MSG, focus: null };
  }
}

export function setUsageFocus(focus: UsageFocus) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(focus));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVT));
}

export function peekUsageFocus(): UsageFocus | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UsageFocus;
  } catch {
    return null;
  }
}

export function clearUsageFocus() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function onUsageFocus(cb: () => void) {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}
