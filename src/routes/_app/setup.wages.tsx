import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/production/setup-wages";

export const Route = createFileRoute("/_app/setup/wages")({ component: Page });
export { WageModal } from "@/production/setup-wages";
