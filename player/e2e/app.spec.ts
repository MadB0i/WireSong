import { expect, test } from "@playwright/test";

test("app shell renders every section", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toContainText("WireSong");
  await expect(page.getByTestId("status")).toHaveText("closed");
  await expect(page.getByTestId("equalizer")).toBeVisible();
  await expect(page.getByTestId("piano-roll")).toBeVisible();
  await expect(page.getByTestId("network-graph")).toBeVisible();
  await expect(page.getByTestId("spectrum-analyzer")).toBeVisible();
  await expect(page.getByTestId("packet-feed")).toBeVisible();
  await expect(page.getByTestId("analytics-panel")).toBeVisible();
  await expect(page.getByTestId("instrument-picker")).toBeVisible();
  await expect(page.getByTestId("record-controls")).toBeVisible();
});

test("live demo streams events into every visualizer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("total")).toHaveText("0");

  await page.getByTestId("replay-button").click();
  await expect(page.getByTestId("replay-indicator")).toBeVisible();

  await expect(
    page.getByTestId("event-log").locator("li").first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("total")).not.toHaveText("0", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("per-second")).not.toHaveText("0", {
    timeout: 15_000,
  });

  const analytics = page.getByTestId("analytics-panel");
  await expect(analytics).toContainText("Event mix", { timeout: 15_000 });
  await expect(analytics).toContainText("tcp_syn", { timeout: 15_000 });

  await page.getByTestId("stop-replay-button").click();
  await expect(page.getByTestId("replay-indicator")).toHaveCount(0);
});

test("redact toggle flips the IP redaction checkbox", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByTestId("redact-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
});