import { test, expect } from "@playwright/test";

test("app shell loads right-to-left in Persian", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBeLessThan(400);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", /^fa/);
  await expect(page.locator("body")).toBeVisible();
});

test("service worker and manifest are served", async ({ request }) => {
  expect((await request.get("/sw.js")).status()).toBe(200);
  expect((await request.get("/hesabdar.webmanifest")).status()).toBe(200);
});
