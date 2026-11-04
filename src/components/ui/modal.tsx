import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  hideClose,
  wide,
  paper,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  hideClose?: boolean;
  wide?: boolean;
  paper?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !hideClose) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, hideClose, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="drawer-scrim absolute inset-0" />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "glass relative z-10 max-h-[92dvh] w-full overflow-y-auto rounded-[22px] border border-white/20 p-5 shadow-panel sm:p-6",
          wide || paper ? (paper ? "max-w-5xl" : "max-w-3xl") : "max-w-lg",
        )}
      >
        {!hideClose ? (
          <button
            type="button"
            onClick={onClose}
            className="close-box absolute top-3 left-3"
            aria-label="بستن"
          >
            <X className="size-4" />
          </button>
        ) : null}
        <h2 className="mb-5 pl-10 text-lg font-semibold">{title}</h2>
        {children}
        {footer ? <div className="mt-5 flex flex-wrap justify-start gap-2">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
