import { test, expect } from "@playwright/test";
import { create, current, home, saved } from "./helpers";
import { semantic } from "../../src/application/v2/history";

test.use({ viewport: { width:1440, height:900 } });
test("responsive document surfaces retain controls, local Cyrillic typography, row density and reduced motion", async ({page}) => {
  await page.goto("./");
  await create(page,"Длинное русское название производственного проекта");
  const original = await current(page);
  await home(page);
  const sizes = [{width:1280,height:800},{width:1440,height:900},{width:1920,height:1080},{width:520,height:900}];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.evaluate(async () => { await document.fonts.ready; });
    await expect(page.getByRole("heading",{name:"Проекты",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"+ Новый проект",exact:true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator(".projects-title-row h1").evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(64);
    const homeButton = page.getByRole("button",{name:"Домой",exact:true});
    await homeButton.focus();
    await homeButton.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(homeButton).toBeFocused();
    expect(await homeButton.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe("none");
    expect(await homeButton.evaluate((e) => getComputedStyle(e).outlineColor)).toBe("rgb(36, 87, 255)");
    const h = await homeButton.boundingBox(), tabs = await page.locator(".folder-tabs").boundingBox();
    if (!h || !tabs) throw Error("Navigation has no layout");
    expect(h.x+h.width).toBeLessThanOrEqual(tabs.x);
  }
  const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.family.includes("Manrope")).map((f) => f.status));
  expect(fonts).toContain("loaded");
  await page.locator(".saved-project-card").getByRole("button",{name:"Открыть",exact:true}).click();
  await saved(page);
  for (const size of sizes) {
    await page.setViewportSize(size);
    const main=page.getByRole("main",{name:"Редактор таймлайна"});
    await expect(main).toBeVisible();
    // Contrast uses the visible composite background, not transparent rgba(0,0,0,0)
    // interpreted as an opaque black surface. Keep the WCAG 4.5:1 threshold.
    let diagnosed = false;
    await expect.poll(async () => {
      const measurement = await page.locator(".folder-tab.active > span").evaluate((element) => {
      type RGBA = { rgb: [number, number, number]; a: number };
      const parse = (value: string): RGBA => {
        if (value === "transparent") return { rgb: [0, 0, 0], a: 0 };
        const vals = (value.match(/[\d.]+/g) ?? []).map(Number);
        const scale = value.startsWith("color(") ? 255 : 1;
        return { rgb: [0, 1, 2].map((i) => (vals[i] ?? 0) * scale) as RGBA["rgb"], a: vals[3] ?? 1 };
      };
      const ancestry: Element[] = [];
      for (let node = element.parentElement; node; node = node.parentElement) ancestry.push(node);
      let background: [number, number, number] = [255, 255, 255];
      for (const node of ancestry.reverse()) {
        const layer = parse(getComputedStyle(node).backgroundColor);
        background = background.map((v, i) => (layer.rgb[i] ?? 0) * layer.a + v * (1 - layer.a)) as typeof background;
      }
      const text = parse(getComputedStyle(element).color);
      const foreground = text.rgb.map((v, i) => v * text.a + (background[i] ?? 255) * (1 - text.a));
      const luminance = (rgb: number[]) => rgb.map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * ([.2126, .7152, .0722][i] ?? 0), 0);
      const left = luminance(foreground), right = luminance(background);
      return { contrast: (Math.max(left, right) + .05) / (Math.min(left, right) + .05),
        viewport: innerWidth, foregroundCss: getComputedStyle(element).color,
        tabBackgroundCss: getComputedStyle(element.parentElement ?? element).backgroundColor,
        ancestry: ancestry.map((node) => ({ node: node.tagName, cls: String(node.className).slice(0, 80), bg: getComputedStyle(node).backgroundColor })),
        blendedBackground: background, parsedForeground: foreground };
      });
      if (measurement.contrast < 4.5 && !diagnosed) {
        diagnosed = true;
        console.log("TAB_CONTRAST_DIAGNOSTIC", JSON.stringify(measurement));
      }
      return measurement.contrast;
    }).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator(".editor-heading h1")).toHaveAttribute("title",original.project.name);
    expect(await page.locator(".process-bar").first().evaluate((e)=>getComputedStyle(e).height)).toBe("24px");
    expect(await page.locator(".task-bar").first().evaluate((e)=>getComputedStyle(e).height)).toBe("22px");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const inspector=page.getByRole("complementary",{name:"Свойства элемента"});
    await inspector.scrollIntoViewIfNeeded();
    await expect(inspector).toBeVisible();
    const box=await inspector.boundingBox(); if(!box) throw Error("Missing inspector layout");
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x+box.width).toBeLessThanOrEqual(size.width);
  }
  await page.emulateMedia({reducedMotion:"reduce"});
  expect(await page.locator(".timeline-workspace").evaluate((e)=>getComputedStyle(e).transitionDuration)).toBe("0s");
  const actual=await current(page);
  expect(semantic(actual)).toBe(semantic(original));
  expect(actual.project.revision).toBe(original.project.revision);
});
