import { expect, test } from "@playwright/test";

test("桌面工作台固定在单个视口并把滚动留给内容区", async ({ page }) => {
  await page.goto("/workbench");
  await expect(page.getByText("@赋范空间 独家研发")).toBeVisible();
  await expect(page.locator("textarea")).toBeVisible();

  const layout = await page.evaluate(() => {
    const main = document.querySelector("main");
    const timeline = document.querySelector<HTMLElement>('[class*="_timeline_"]');
    const sessions = document.querySelector<HTMLElement>('[class*="_sessionDock_"]');
    const inspector = document.querySelector<HTMLElement>('[class*="_processInspector_"]');
    const footer = document.querySelector("footer");
    const composer = document.querySelector("textarea");
    const footerBox = footer?.getBoundingClientRect();
    const composerBox = composer?.getBoundingClientRect();

    return {
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.scrollHeight,
      mainOverflowY: main ? getComputedStyle(main).overflowY : null,
      timelineOverflowY: timeline ? getComputedStyle(timeline).overflowY : null,
      sessionsOverflowY: sessions ? getComputedStyle(sessions).overflowY : null,
      inspectorOverflowY: inspector ? getComputedStyle(inspector).overflowY : null,
      footerBottom: footerBox?.bottom ?? null,
      composerBottom: composerBox?.bottom ?? null,
      footerTop: footerBox?.top ?? null
    };
  });

  expect(layout.documentHeight - layout.viewportHeight).toBeLessThanOrEqual(1);
  expect(layout.bodyHeight - layout.viewportHeight).toBeLessThanOrEqual(1);
  expect(layout.mainOverflowY).toBe("hidden");
  expect(layout.timelineOverflowY).toBe("auto");
  expect(layout.sessionsOverflowY).toBe("auto");
  expect(layout.inspectorOverflowY).toBe("auto");
  expect(layout.footerBottom).not.toBeNull();
  expect(layout.footerBottom!).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.composerBottom).not.toBeNull();
  expect(layout.footerTop).not.toBeNull();
  expect(layout.composerBottom!).toBeLessThan(layout.footerTop!);
});
