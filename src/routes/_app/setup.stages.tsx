import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/production/setup-stages";

export const Route = createFileRoute("/_app/setup/stages")({ component: Page });
