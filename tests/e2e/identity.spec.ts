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
    const tabContrast = await page.locator(".folder-tab.active > span").evaluate((element) => {
      const luminance = (color:string) => {
        const values = (color.match(/[\d.]+/g) ?? []).slice(0,3).map(Number).map((v) => v/255).map((v) => v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
        return (values[0] ?? 0)*.2126 + (values[1] ?? 0)*.7152 + (values[2] ?? 0)*.0722;
      };
      const text=luminance(getComputedStyle(element).color), background=luminance(getComputedStyle(element.parentElement ?? element).backgroundColor);
      return (Math.max(text,background)+.05)/(Math.min(text,background)+.05);
    });
    expect(tabContrast).toBeGreaterThanOrEqual(4.5);
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
