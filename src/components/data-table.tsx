import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  header: string;
  className?: string;
  cell: (row: T) => ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "موردی ثبت نشده است",
  excel,
  tone,
  toolbar,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  empty?: string;
  excel?: string | false;
  tone?: "a" | "b" | "c" | "d";
  toolbar?: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);

  return (
    <div>
    <div className={tone ? "dash-card list-card" : undefined}>
      {toolbar ? <div className="border-b border-border px-2 pt-2">{toolbar}</div> : null}
      <div ref={wrap} className={tone ? "overflow-x-auto" : "overflow-x-auto rounded-md border border-border bg-surface"}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-2xs sm:text-sm">
          <thead>
            <tr className={tone ? undefined : "bg-surface-2"}>
              {columns.map((c, i) => (
                <th
                  key={`${c.header}-${i}`}
                  className={cn(
                    "border-b border-border px-2 py-2 text-center text-sm font-bold leading-none whitespace-nowrap text-muted sm:px-2.5",
                    !c.header && "w-28",
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-muted">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={rowKey(row)} className={tone ? undefined : i % 2 ? "bg-bg-warm/40" : "bg-surface"}>
                  {columns.map((c, ci) => (
                    <td
                      key={`${c.header}-${ci}`}
                      className={cn(
                        "border-b border-border px-2 py-2 text-center align-middle leading-none whitespace-nowrap sm:px-2.5",
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}
