import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "داشبورد" },
  { to: "/cashbook", label: "روزنامچه دخل" },
] as const;

/** Two small flat tabs at the top of the dashboard: «داشبورد» and «روزنامچه دخل». */
export function DashTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="dash-tabs no-print export-exclude flex gap-1.5" role="tablist">
      {TABS.map((t) => {
        const active = t.to === "/" ? pathname === "/" : pathname.startsWith(t.to);
        return (
          <Link
            key={t.to}
            to={t.to}
            role="tab"
            aria-selected={active}
            className={cn(
              "company-chip inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium whitespace-nowrap",
              active ? "chip-on border-white/70" : "border-white/25",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
