import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/production/setup-overheads";

export const Route = createFileRoute("/_app/setup/overheads")({ component: Page });
