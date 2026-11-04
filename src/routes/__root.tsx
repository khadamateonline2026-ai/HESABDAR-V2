import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { queryClient } from "@/lib/query-client";
import { restoreCachedAppearance } from "@/lib/prefs";
import { installOffline } from "@/lib/offline/engine";
import appCss from "../styles.css?url";

installOffline();

const APP_NAME = "HESABDAR";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#07040c" },
      { name: "apple-mobile-web-app-title", content: "HESABDAR" },
      { name: "application-name", content: "HESABDAR" },
      { name: "description", content: "برنامه حسابداری به زبان دری برای مدیریت دخل، طرف حساب‌ها، خرید و فروش" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/favicon.png?v=hesabdar2" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png?v=hesabdar2" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/hesabdar.webmanifest" },
    ],
  }),
  component: RootDocument,
});

function AppearanceBoot() {
  useEffect(() => {
    restoreCachedAppearance();
  }, []);
  return null;
}

function RootDocument() {
  return (
    <html lang="fa-AF" dir="rtl" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-bg text-fg">
        <AppearanceBoot />
        <PreviewHostBridge />
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <Outlet />
          </QueryClientProvider>
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
