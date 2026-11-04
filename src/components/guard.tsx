import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAppData } from "@/components/layout/app-shell";
import { canView, type Area } from "@/lib/permissions";

export function Guard({ area, children }: { area: Area; children: ReactNode }) {
  const { data, isPending } = useAppData();
  if (isPending) return null;
  const role = data?.profile?.role;
  if (!role) return null;
  if (!canView(role, area)) return <Navigate to="/" />;
  return <>{children}</>;
}
