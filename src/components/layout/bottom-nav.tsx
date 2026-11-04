import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Receipt, ShoppingBag, ShoppingCart, Users, Warehouse } from "lucide-react";
import { MoneyExchangeIcon } from "@/components/money-exchange-icon";
import { canView, type Area } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const ITEMS: {
  to: string;
  label: string;
  area: Area;
  icon: typeof LayoutDashboard | typeof MoneyExchangeIcon;
  iconOnly?: boolean;
}[] = [
  { to: "/", label: "داشبورد", area: "dashboard", icon: LayoutDashboard },
  { to: "/purchase", label: "خرید", area: "purchase", icon: ShoppingBag },
  { to: "/sales", label: "فروش", area: "sales", icon: ShoppingCart },
  { to: "/payments", label: "پرداخت و دریافت", area: "payments", icon: MoneyExchangeIcon },
  { to: "/warehouses", label: "گدام‌ها", area: "warehouses", icon: Warehouse },
  { to: "/workers", label: "کارگران", area: "workers", icon: Users },
  { to: "/expenses", label: "هزینه‌ها", area: "expenses", icon: Receipt },
];

export function BottomNav({ role }: { role: Role | null }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = ITEMS.filter((i) => canView(role, i.area));
  if (!items.length) return null;

  return (
    <nav
      className="magnify-nav no-print fixed inset-x-0 bottom-0 z-30 overflow-visible"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="منوی پایین"
    >
      <ul className="mx-auto flex h-[4.75rem] max-w-6xl items-stretch overflow-visible">
        {items.map((item) => {
          const active = item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`);
          const Icon = item.icon;
          return (
            <li key={item.to} className="relative flex-1 overflow-visible">
              <Link
                to={item.to}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "magnify-item relative flex h-full flex-col items-center justify-center gap-1 overflow-visible px-0.5",
                  active && "active",
                )}
              >
                <span className="relative grid place-items-center">
                  <span className="magnify-pill" />
                  <Icon
                    className={cn(
                      "magnify-icon relative z-10 transition-transform duration-200",
                      item.to === "/payments" ? "size-11" : "size-7",
                    )}
                  />
                </span>
                <span className="max-w-full truncate text-2xs font-medium leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
