import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/production/setup-jobs";

export const Route = createFileRoute("/_app/setup/jobs")({ component: Page });
