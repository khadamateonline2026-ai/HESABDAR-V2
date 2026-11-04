import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export function ConfirmAccountantReset({
  open,
  title,
  message,
  confirmLabel = "پاک کردن تاریخچه",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setCode("");
      setError("");
      setBusy(false);
    }
  }, [open]);

  return (
    <Modal open={open} title={title} onClose={() => !busy && onClose()}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!code.trim()) return;
          setBusy(true);
          setError("");
          try {
            await onConfirm(code.trim());
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "عملیات ناکام شد");
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm leading-relaxed text-muted">{message}</p>
        <Field label="کد نقش حسابدار">
          <Input
            dir="ltr"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="danger" disabled={busy || !code.trim()}>
            {busy ? "…" : confirmLabel}
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            انصراف
          </Button>
        </div>
      </form>
    </Modal>
  );
}
