/**
 * نشانگر «در حال ثبت» سراسری.
 *
 * مشکل قبلی: هر درخواست POST جدا نشانگر را روشن/خاموش می‌کرد؛ بعد از ذخیره،
 * invalidate چند refetch پشت سر هم می‌فرستاد و نشانگر چند بار چشمک می‌زد.
 * حالا: یک بار روشن می‌شود (بعد از ۲۰۰ms)، تا وقتی درخواستی باقی است یا
 * refetchهای بعد از ذخیره در جریان است روشن می‌ماند، و فقط پس از یک مهلت
 * کوتاه بی‌کاری (۴۰۰ms) خاموش می‌شود.
 */
export type BusyDeps = {
  setVisible: (on: boolean) => void;
  /** تعداد queryهای در حال fetch (react-query) */
  fetching: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (h: unknown) => void;
  showDelayMs?: number;
  hideGraceMs?: number;
};

export function createBusyIndicator(deps: BusyDeps) {
  const showDelay = deps.showDelayMs ?? 200;
  const hideGrace = deps.hideGraceMs ?? 400;
  let active = 0;
  let shown = false;
  let showTimer: unknown = null;
  let hideTimer: unknown = null;

  const busy = () => active > 0 || (shown && deps.fetching() > 0);

  function sync() {
    if (busy()) {
      if (hideTimer != null) {
        deps.clearTimeout(hideTimer);
        hideTimer = null;
      }
      if (!shown && showTimer == null) {
        showTimer = deps.setTimeout(() => {
          showTimer = null;
          if (busy() || active > 0) {
            shown = true;
            deps.setVisible(true);
          }
        }, showDelay);
      }
      return;
    }
    if (showTimer != null && active === 0) {
      deps.clearTimeout(showTimer);
      showTimer = null;
    }
    if (shown && hideTimer == null) {
      hideTimer = deps.setTimeout(() => {
        hideTimer = null;
        if (busy()) return;
        shown = false;
        deps.setVisible(false);
      }, hideGrace);
    }
  }

  return {
    begin() {
      active += 1;
      sync();
    },
    end() {
      active = Math.max(0, active - 1);
      sync();
    },
    sync,
    dispose() {
      if (showTimer != null) deps.clearTimeout(showTimer);
      if (hideTimer != null) deps.clearTimeout(hideTimer);
      showTimer = hideTimer = null;
      shown = false;
      active = 0;
      deps.setVisible(false);
    },
    get visible() {
      return shown;
    },
  };
}
