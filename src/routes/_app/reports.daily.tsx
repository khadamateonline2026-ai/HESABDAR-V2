import { createFileRoute, redirect } from "@tanstack/react-router";

/** «روزنامچه دخل» moved next to the dashboard; the old address keeps working. */
export const Route = createFileRoute("/_app/reports/daily")({
  beforeLoad: () => {
    throw redirect({ to: "/cashbook", replace: true });
  },
});
