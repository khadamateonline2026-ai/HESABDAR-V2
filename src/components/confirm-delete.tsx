import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { parseUsageError, setUsageFocus } from "@/lib/usage-focus";

export function ConfirmDelete({
  open,
  title = "حذف این مورد",
  message = "این مورد حذف شود؟ برای تأیید، کد یک‌رقمی را وارد کنید.",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title?: string;
  message?: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const [code, setCode] = useState("0");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setCode(String(Math.floor(Math.random() * 10)));
      setInput("");
      setError("");
      setBusy(false);
    }
  }, [open]);

  async function submit() {
    if (input.trim() !== code) {
      setError("کد تأیید نادرست است");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "حذف ناکام شد");
    } finally {
      setBusy(false);
    }
  }

  const parsed = error ? parseUsageError(error) : { text: "", focus: null };

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p className="mb-4 text-sm leading-6 text-muted">{message}</p>
      <p className="mb-3 text-sm">
        کد تأیید: <span className="font-semibold tabular-nums">{code}</span>
      </p>
      <Field label="کد یک‌رقمی">
        <Input
          inputMode="numeric"
          maxLength={1}
          dir="ltr"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/\D/g, "").slice(0, 1))}
        />
      </Field>
      {parsed.text ? (
        <div className="mt-2 flex items-center gap-1.5">
          <p className="text-sm text-danger">{parsed.text}</p>
          {parsed.focus ? (
            <button
              type="button"
              className="h-6 shrink-0 rounded-sm border border-danger/50 px-1.5 text-micro leading-none text-danger hover:bg-danger-soft"
              onClick={() => {
                const focus = parsed.focus;
                if (!focus) return;
                setUsageFocus(focus);
                onClose();
                void navigate({ to: focus.path });
              }}
            >
              مشاهده
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="mt-5 flex justify-start gap-2">
        <Button onClick={submit} disabled={busy || input.length === 0}>
          {busy ? "…" : "تأیید"}
        </Button>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          لغو
        </Button>
      </div>
    </Modal>
  );
}