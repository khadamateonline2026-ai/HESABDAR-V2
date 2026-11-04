import { AddButton } from "@/components/add-button";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  onAdd,
  canAdd,
  titleClass,
}: {
  title: string;
  onAdd?: () => void;
  canAdd?: boolean;
  titleClass?: string;
}) {
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className={cn("text-xl font-semibold", titleClass)}>{title}</h1>
      </div>
      {canAdd && onAdd ? <AddButton fab onClick={onAdd} /> : null}
    </>
  );
}
