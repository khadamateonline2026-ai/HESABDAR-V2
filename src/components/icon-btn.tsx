import { Pencil, Printer, Trash2 } from "lucide-react";
import { MoneyExchangeIcon } from "@/components/money-exchange-icon";
import { cn } from "@/lib/utils";

type Kind = "edit" | "delete" | "print" | "pay";

const labels: Record<Kind, string> = {
  edit: "ویرایش",
  delete: "حذف",
  print: "چاپ",
  pay: "پرداخت",
};

export function IconBtn({
  kind,
  onClick,
  disabled,
}: {
  kind: Kind;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={labels[kind]}
      className={cn(
        "grid size-9 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg",
        kind === "delete" && "hover:bg-danger-soft hover:text-danger",
        kind === "pay" && "text-primary hover:bg-primary-soft hover:text-primary",
        disabled && "cursor-not-allowed opacity-35 hover:bg-transparent hover:text-muted",
      )}
    >
      {kind === "edit" ? (
        <Pencil className="size-4" />
      ) : kind === "delete" ? (
        <Trash2 className="size-4" />
      ) : kind === "print" ? (
        <Printer className="size-4" />
      ) : (
        <MoneyExchangeIcon className="size-5" />
      )}
    </button>
  );
}

export function RowActions({
  onEdit,
  onDelete,
  onPrint,
  onPay,
  canWrite,
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  onPrint?: () => void;
  onPay?: () => void;
  canWrite?: boolean;
}) {
  return (
    <div className="flex items-center justify-start gap-0.5">
      {onPrint ? <IconBtn kind="print" onClick={onPrint} /> : null}
      {onEdit ? <IconBtn kind="edit" onClick={onEdit} disabled={!canWrite} /> : null}
      {onDelete ? <IconBtn kind="delete" onClick={onDelete} disabled={!canWrite} /> : null}
      {onPay ? <IconBtn kind="pay" onClick={onPay} disabled={!canWrite} /> : null}
    </div>
  );
}
