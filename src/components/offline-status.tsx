import { useEffect, useState } from "react";
import { getOfflineStatus, subscribeOffline, type OfflineStatus } from "@/lib/offline/engine";

export function OfflineStatus() {
  const [state, setState] = useState<OfflineStatus>(getOfflineStatus());
  useEffect(() => subscribeOffline(setState), []);
  const label =
    state.phase === "offline"
      ? "آفلاین — داده‌ها محلی ذخیره می‌شوند"
      : state.phase === "syncing"
        ? "در حال همگام‌سازی با سرور…"
        : "آنلاین";
  const tone =
    state.phase === "offline"
      ? "text-amber-700 dark:text-amber-300"
      : state.phase === "syncing"
        ? "text-sky-700 dark:text-sky-300"
        : "text-emerald-700 dark:text-emerald-300";
  return (
    <span className={`text-2xs ${tone}`} title={state.warning || label} role="status" aria-live="polite">
      {label}
      {state.pending > 0 ? ` · صف: ${state.pending}` : ""}
      {state.warning ? " · !" : ""}
    </span>
  );
}
