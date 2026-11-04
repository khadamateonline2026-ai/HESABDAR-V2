import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function AddButton({
  onClick,
  disabled,
  label = "افزودن",
  fab = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  fab?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "grid place-items-center border border-primary bg-primary text-primary-fg shadow-panel",
        "hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40",
        fab
          ? "fixed z-40 size-12 rounded-md bottom-[5.5rem] right-4"
          : "size-9 rounded-md",
      )}
    >
      <Plus className={fab ? "size-6" : "size-4"} strokeWidth={2.4} />
    </button>
  );
}
