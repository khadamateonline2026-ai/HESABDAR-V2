import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Guard } from "@/components/guard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/reports")({ component: Page });

const TABS = [
  { to: "/reports", label: "فروشات" },
  { to: "/reports/receivables", label: "طلبات" },
  { to: "/reports/payables", label: "بدهی‌ها" },
  { to: "/reports/history", label: "تاریخچه" },
] as const;

function Page() {
  return (
    <Guard area="reports">
      <ReportsLayout />
    </Guard>
  );
}

function ReportsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="reports-area">
      <h1 className="mb-4 text-xl font-semibold">گزارش‌ها</h1>
      <div className="reports-tabs no-print mb-5 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active = pathname === tab.to;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "inline-flex h-11 items-center rounded-sm border px-4 text-sm",
                active
                  ? "border-primary bg-primary-soft font-medium text-primary"
                  : "border-border bg-surface text-fg hover:bg-surface-2",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}
