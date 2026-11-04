import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronDown,
  Coins,
  Landmark,
  LogOut,
  Menu,
  Settings,
  StickyNote,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";
import { ImageSlot } from "@/components/image-slot";
import { BottomNav } from "@/components/layout/bottom-nav";
import { OnboardingModal, RoleGateModal, logoutNow } from "@/components/onboarding";
import { OfflineStatus } from "@/components/offline-status";
import { getBootstrap, saveCompany } from "@/lib/api/core";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { todayIso } from "@/lib/format";
import { headerDateParts } from "@/lib/jalali";
import { canView, type Area } from "@/lib/permissions";
import { applyAppearance, PrefsProvider } from "@/lib/prefs";
import { queryClient } from "@/lib/query-client";
import { DEFAULT_SETTINGS, ROLE_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; area: Area };
type NavGroup = { label: string; area: Area; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "تنظیمات اولیه",
    area: "company",
    items: [
      { to: "/setup/company", label: "اطلاعات شرکت", area: "company" },
      { to: "/setup/parties", label: "طرف حساب‌ها", area: "parties" },
      { to: "/setup/wages", label: "نرخ دستمزد", area: "wages" },
      { to: "/setup/jobs", label: "وظایف", area: "jobs" },
      { to: "/setup/overheads", label: "هزینه‌های متفرقه تولید", area: "units" },
      { to: "/setup/currencies", label: "ارزها", area: "currencies" },
      { to: "/setup/units", label: "واحدها", area: "units" },
    ],
  },
  {
    label: "مالی و حساب‌ها",
    area: "accounts",
    items: [
      { to: "/finance/accounts", label: "دخل", area: "accounts" },
      { to: "/finance/transfers", label: "انتقالات", area: "transfers" },
      { to: "/finance/capital", label: "سرمایه و برداشت", area: "capital" },
      { to: "/finance/opening", label: "تعدیل موجودی", area: "opening" },
    ],
  },
  {
    label: "گزارش‌ها",
    area: "reports",
    items: [
      { to: "/reports", label: "فروشات", area: "reports" },
      { to: "/reports/receivables", label: "طلبات", area: "reports" },
      { to: "/reports/payables", label: "بدهی‌ها", area: "reports" },
      { to: "/reports/history", label: "تاریخچه", area: "reports" },
    ],
  },
];

function groupLabelForPath(pathname: string): string {
  for (const group of GROUPS) {
    if (group.items.some((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))) return group.label;
  }
  return "";
}

export function AppShell() {
  const { user, isPending } = useCurrentUserState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => getBootstrap(),
    enabled: Boolean(user),
  });
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string>("");
  const [needRoleGate, setNeedRoleGate] = useState(false);
  const dateParts = useMemo(() => headerDateParts(todayIso()), []);
  const settings = bootstrap.data?.settings ?? DEFAULT_SETTINGS;
  const profile = bootstrap.data?.profile ?? null;

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (bootstrap.data?.settings) applyAppearance(bootstrap.data.settings);
  }, [bootstrap.data?.settings]);

  useEffect(() => {
    if (!user || !profile) {
      setNeedRoleGate(false);
      return;
    }
    setNeedRoleGate(Boolean(bootstrap.data?.needsSessionRole));
  }, [user, profile, bootstrap.data?.needsSessionRole]);

  useEffect(() => {
    const orig = window.fetch.bind(window);
    let active = 0;
    let timer: number | null = null;
    window.fetch = (input, init) => {
      const method = String(
        init?.method || (input instanceof Request ? input.method : "GET"),
      ).toUpperCase();
      if (method !== "POST") return orig(input, init);
      active += 1;
      if (timer == null && !document.documentElement.classList.contains("app-busy")) {
        timer = window.setTimeout(() => {
          timer = null;
          if (active > 0) document.documentElement.classList.add("app-busy");
        }, 200);
      }
      return orig(input, init).finally(() => {
        active = Math.max(0, active - 1);
        if (active === 0) {
          if (timer != null) {
            window.clearTimeout(timer);
            timer = null;
          }
          document.documentElement.classList.remove("app-busy");
        }
      });
    };
    return () => {
      window.fetch = orig;
      if (timer != null) window.clearTimeout(timer);
      document.documentElement.classList.remove("app-busy");
    };
  }, []);

  if (isPending) {
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <div className="h-10 w-48 animate-pulse rounded-md bg-border" />
      </div>
    );
  }
  if (!user) return <RedirectToSignIn />;

  const needsSessionRole = Boolean(bootstrap.data?.needsSessionRole);
  const role = needsSessionRole ? null : (profile?.role ?? null);
  const company = bootstrap.data?.company;

  const showLogout = typeof window !== "undefined" ? !hasGateSessionMarker() : true;

  return (
    <PrefsProvider value={settings}>
    <div className={cn("app-bg min-h-dvh text-fg", open && "drawer-dim")}>
      <header className="app-topbar glass no-print sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-white/15 px-3 py-1.5">
        <button
          type="button"
          onClick={() => {
            setExpanded(groupLabelForPath(pathname));
            setOpen(true);
          }}
          className="gold-ring grid size-11 shrink-0 place-items-center rounded-full bg-bg text-fg"
          aria-label="منو"
        >
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-3 text-2xs font-medium leading-none whitespace-nowrap sm:text-xs">
          <OfflineStatus />
          <span className="text-muted">{dateParts.weekday}</span>
          <div className="flex flex-col items-center gap-px tabular-nums leading-tight" dir="ltr">
            <span>{dateParts.jalali}</span>
            <span>{dateParts.gregorian}</span>
          </div>
          <span className="text-subtle">{role ? ROLE_LABELS[role] : ""}</span>
        </div>
      </header>

      {open ? (
        <button
          type="button"
          className="drawer-scrim no-print fixed inset-0 z-40"
          aria-label="بستن منو"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className="drawer-panel no-print fixed top-0 right-0 z-50 flex h-dvh w-[min(22rem,92vw)] flex-col"
        style={{
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)",
          pointerEvents: open ? "auto" : "none",
        }}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between px-3 pt-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="close-box"
            aria-label="بستن"
          >
            <X className="size-4" />
          </button>
          <span className="text-xs text-muted">منو</span>
        </div>
        <div className="flex flex-col items-center gap-3 px-5 pb-4 pt-2">
          <ImageSlot
            src={company?.logo || "/app-icon.png"}
            size={88}
            editable={Boolean(role && role !== "supervisor" && profile)}
            onChange={(logo) => {
              if (!company) return;
              void saveCompany({
                data: {
                  name: company.name,
                  logo,
                  licenseNo: company.licenseNo,
                  tin: company.tin,
                  address: company.address,
                  phone1: company.phone1,
                  phone2: company.phone2,
                  phone3: company.phone3,
                  email: company.email,
                },
              }).then(() => queryClient.invalidateQueries({ queryKey: ["bootstrap"] }));
            }}
          />
          <div className="text-center text-xl font-bold leading-tight">{company?.name || "دفتر حساب"}</div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
          {GROUPS.map((group) => {
            const production = settings.productionEnabled !== false;
            const visible = group.items.filter((i) => {
              if (!canView(role, i.area)) return false;
              if (production) return true;
              return (
                i.to !== "/setup/wages" &&
                i.to !== "/setup/jobs" &&
                i.to !== "/setup/overheads"
              );
            });
            if (!visible.length) return null;
            const isOpen = expanded === group.label;
            return (
              <div key={group.label} className="rounded-md">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? "" : group.label)}
                  className="drawer-link flex h-12 w-full items-center justify-between rounded-[14px] px-3 text-base font-medium text-muted hover:text-fg"
                >
                  <span className="flex items-center gap-2">
                    {group.label === "مالی و حساب‌ها" ? (
                      <Landmark className="size-4 text-primary" />
                    ) : group.label === "گزارش‌ها" ? (
                      <BookOpen className="size-4 text-primary" />
                    ) : (
                      <Coins className="size-4 text-primary" />
                    )}
                    {group.label}
                  </span>
                  <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen
                  ? visible.map((item) => (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "drawer-link flex h-12 items-center rounded-[14px] py-2 pr-9 pl-3 text-base text-muted hover:text-fg",
                          pathname === item.to && "drawer-active font-medium",
                        )}
                      >
                        {item.label}
                      </Link>
                    ))
                  : null}
              </div>
            );
          })}
          {canView(role, "notes") ? (
            <Link
              to="/notes"
              onClick={() => setOpen(false)}
              className={cn(
                "drawer-link flex h-12 items-center gap-2 rounded-[14px] px-3 text-base text-muted hover:text-fg",
                pathname === "/notes" && "drawer-active font-medium",
              )}
            >
              <StickyNote className="size-4" />
              یادداشت‌های مهم
            </Link>
          ) : null}
          {canView(role, "settings") ? (
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className={cn(
                "drawer-link flex h-12 items-center gap-2 rounded-[14px] px-3 text-base text-muted hover:text-fg",
                pathname === "/settings" && "drawer-active font-medium",
              )}
            >
              <Settings className="size-4" />
              تنظیمات
            </Link>
          ) : null}
        </nav>
        {showLogout ? (
          <div className="border-t border-border p-3">
            <button
              type="button"
              onClick={() => {
                void logoutNow();
              }}
              className="flex h-12 w-full items-center justify-start gap-2 rounded-[14px] px-3 text-base text-danger hover:bg-danger-soft"
            >
              <LogOut className="size-4" />
              خروج از حساب
            </button>
          </div>
        ) : null}
      </aside>

      <main className="stage mx-auto w-full max-w-6xl px-4 pb-28 pt-2 sm:px-8">
        {bootstrap.isPending ? (
          <div className="h-40 animate-pulse rounded-md bg-border/60" />
        ) : (
          <Outlet />
        )}
      </main>
      <BottomNav role={role} />
      <OnboardingModal open={Boolean(user) && !bootstrap.isPending && !profile} userId={user?.id ?? ""} />
      {user && profile && !bootstrap.isPending && needRoleGate ? (
        <RoleGateModal
          open
          userId={user.id}
          currentRole={needsSessionRole ? "accountant" : profile.role}
          staff={bootstrap.data?.staff ?? []}
          onDone={() => setNeedRoleGate(false)}
        />
      ) : null}
      <Toaster dir="rtl" position="top-center" richColors />
    </div>
    </PrefsProvider>
  );
}

export function useAppData() {
  return useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => getBootstrap(),
  });
}

export function useInvalidate() {
  const m = useMutation({
    mutationFn: async () => undefined,
  });
  return async () => {
    await queryClient.invalidateQueries();
    return m;
  };
}
