import { copyFileSync, readFileSync } from "node:fs";
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

test("instrument pack manifests are served as JSON", async ({ request }) => {
  for (const id of ["ambient", "chiptune", "orchestral", "ensemble", "axom", "bodo"]) {
    const res = await request.get(`/packs/${id}/pack.json`);
    expect(res.ok(), `/packs/${id}/pack.json serves`).toBeTruthy();
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(Object.keys(body.events)).toHaveLength(8);
    expect(body.displayName).toBeTruthy();
    expect(body.events.port_scan_alert.role).toBe("alarm");
    expect(body.events.tcp_syn.voice).toBeTruthy();
    expect(body.events.tcp_syn.fallbackSynth.kind).toBeTruthy();
  }
});
test("raga picker switches raga and toggles clock and meend", async ({ page }) => {
  await page.goto("/");
  const picker = page.getByTestId("raga-picker");
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("raga-active")).toContainText("Bhupali");
  await page.getByTestId("raga-yaman").click();
  await expect(page.getByTestId("raga-yaman")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("raga-active")).toContainText("Yaman");
  await page.getByTestId("raga-clock-toggle").click();
  await expect(page.getByTestId("raga-clock-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("meend-toggle").click();
  await expect(page.getByTestId("meend-toggle")).toHaveAttribute("aria-pressed", "true");
});

test("culture packs stream the demo through fallback synths", async ({ page }) => {
  for (const pack of ["pack-axom", "pack-bodo"]) {
    await page.goto("/");
    await expect(page.getByTestId("total")).toHaveText("0");
    await page.getByTestId(pack).click();
    await expect(page.getByTestId(pack)).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("replay-button").click();
    await expect(page.getByTestId("total")).not.toHaveText("0", {
      timeout: 15_000,
    });
    await page.getByTestId("stop-replay-button").click();
    await expect(page.getByTestId("replay-indicator")).toHaveCount(0);
  }
});

test("festival picker follows the active pack calendar", async ({ page, request }) => {
  await page.goto("/");
  // Packs without a calendar expose no festival UI.
  await expect(page.getByTestId("festival-picker")).toHaveCount(0);
  await page.getByTestId("pack-axom").click();
  await expect(page.getByTestId("festival-picker")).toBeVisible();
  // Festival ids come from the pack's own manifest — never hardcoded.
  const res = await request.get("/packs/axom/pack.json");
  const manifest = await res.json();
  const ids: string[] = manifest.festivals.map((f: { id: string }) => f.id);
  expect(ids.length).toBeGreaterThan(0);
  await page.getByTestId(`festival-${ids[0]}`).click();
  await expect(page.getByTestId(`festival-${ids[0]}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("festival-auto-toggle").click();
  await expect(page.getByTestId("festival-auto-toggle")).toHaveAttribute("aria-pressed", "true");
  // Placeholder packs carry a community-review badge; stock packs do not.
  await expect(page.getByTestId("pack-axom-badge")).toContainText("awaiting community review");
  await expect(page.getByTestId("pack-bodo-badge")).toContainText("awaiting community review");
  await expect(page.getByTestId("pack-ambient-badge")).toHaveCount(0);
});

test("full ip view is off by default; toggle flips it", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByTestId("redact-toggle");
  await expect(toggle).toContainText("IPs hidden");
  await toggle.click();
  await expect(toggle).toContainText("Full IP view");
  await toggle.click();
  await expect(toggle).toContainText("IPs hidden");
});

test("recording exports a self-contained share page", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByTestId("replay-button").click();
  await expect(page.getByTestId("total")).not.toHaveText("0", {
    timeout: 15_000,
  });
  await page.getByTestId("record-button").click();
  await page.waitForTimeout(3000);

  const audioDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("record-button").click();
  await audioDownloadPromise;

  await expect(page.getByTestId("export-share-button")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-share-button").click();
  const download = await downloadPromise;
  const filePath = await download.path();
  const html = readFileSync(filePath!, "utf-8");
  expect(html).toContain("WireSong");
  expect(html).toContain("<canvas");
  expect(html).toContain("port_scan_alert");

  const exported = await context.newPage();
  const htmlPath = `${filePath}.html`;
  copyFileSync(filePath!, htmlPath);
  await exported.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
  await expect(exported.locator("canvas")).toBeVisible();
  await expect(exported.locator("body")).toContainText("Network Soundscape");
});