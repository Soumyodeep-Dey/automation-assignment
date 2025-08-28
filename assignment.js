import "dotenv/config";
import fs from "fs";
import path from "path";
import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { chromium } from "playwright";

// ===== Browser Launch =====
const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: ["--disable-extensions"],
});
const page = await browser.newPage();

// ===== Screenshot Setup =====
const screenshotsDir = path.join(process.cwd(), "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}
let screenshotCounter = 0;
function getScreenshotPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  screenshotCounter++;
  return path.join(screenshotsDir, `${timestamp}_screenshot_${screenshotCounter}.png`);
}

// ===== Tools =====
const takeScreenShot = tool({
  name: "take_screenshot",
  description: "Takes a screenshot of the page and saves it",
  parameters: z.object({}),
  async execute() {
    const buf = await page.screenshot({ type: "png", fullPage: true });
    const pathOut = getScreenshotPath();
    fs.writeFileSync(pathOut, buf);
    console.log(`📸 Screenshot saved: ${pathOut}`);
    return pathOut;
  },
});

const openURL = tool({
  name: "open_url",
  description: "Navigate to URL",
  parameters: z.object({ url: z.string() }),
  async execute(input) {
    await page.goto(input.url, { waitUntil: "networkidle", timeout: 30000 });
    return `Navigated to ${page.url()} with title "${await page.title()}"`;
  },
});

const waitForElement = tool({
  name: "wait_for_element",
  description: "Waits for element",
  parameters: z.object({ selector: z.string(), timeout: z.number().nullable() }),
  async execute(input) {
    const timeout = input.timeout || 5000;
    await page.locator(input.selector).first().waitFor({ state: "visible", timeout });
    return `Element ${input.selector} visible`;
  },
});

const clearAndType = tool({
  name: "clear_and_type",
  description: "Clears input and types",
  parameters: z.object({ selector: z.string(), text: z.string() }),
  async execute(input) {
    const el = page.locator(input.selector).first();
    await el.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await el.type(input.text, { delay: 10 });
    return `Typed "${input.text}" in ${input.selector}`;
  },
});

const clickSidebarItem = tool({
  name: "click_sidebar_item",
  description: "Clicks sidebar item by text",
  parameters: z.object({ text: z.string() }),
  async execute(input) {
    const el = page.locator(`a:has-text("${input.text}")`).first();
    await el.click({ timeout: 5000 });
    return `Clicked sidebar item: ${input.text}`;
  },
});

const clickElement = tool({
  name: "click_element",
  description: "Clicks element by CSS selector",
  parameters: z.object({ selector: z.string() }),
  async execute(input) {
    await page.locator(input.selector).first().click({ timeout: 5000 });
    return `Clicked element: ${input.selector}`;
  },
});

// ===== Agent =====
const websiteAutomationAgent = new Agent({
  name: "ChaiCode Sign Up Agent",
  instructions: `
    Automate sign-up flow on https://ui.chaicode.com:
    1. Take screenshot
    2. Navigate to site
    3. Screenshot
    4. Click "Sign Up" sidebar item
    5. Screenshot
    6. Fill form fields using wait_for_element + clear_and_type:
       - First Name → input[placeholder="First Name"] → "Test"
       - Last Name → input[placeholder="Last Name"] → "User"
       - Email → input[placeholder="john@example.com"] → "test@chaicode.com"
       - Username → input[placeholder="Username"] → "testuser123"
       - Password → input[placeholder="Password"] → "TestPassword123!"
       - Confirm Password → input[placeholder="Confirm Password"] → "TestPassword123!"
       - Phone → input[type="tel"] → "+1234567890"
    7. Submit form with click_element on 'button[type="submit"]'
    8. Final screenshot
  `,
  tools: [takeScreenShot, openURL, waitForElement, clearAndType, clickSidebarItem, clickElement],
});

// ===== Main =====
async function executeAutomation() {
  try {
    console.log("🚀 Starting automation...");
    const result = await run(
      websiteAutomationAgent,
      [
        {
          role: "user",
          content: "Run the full sign-up automation flow as per your instructions.",
        },
      ],
      {
        maxTurns: 30,
        apiKey: process.env.OPENAI_API_KEY,
      }
    );
    console.log("✅ Done! Final output:", result.finalOutput);
  } catch (err) {
    console.error("❌ Error:", err);
    try {
      await takeScreenShot.execute({});
    } catch { }
  } finally {
    await browser.close();
    console.log("🌐 Browser closed");
  }
}

executeAutomation().catch(console.error);
