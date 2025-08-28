import "dotenv/config";
import fs from "fs";
import path from "path";
import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { chromium } from "playwright";

// ========== Browser Launch ==========
const browser = await chromium.launch({
  headless: false,
  channel: "chrome", // Use installed Chrome
  args: ["--disable-extensions"], // keep minimal args
});

const page = await browser.newPage();

// ========== Screenshot Setup ==========
const screenshotsDir = path.join(process.cwd(), "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}
let screenshotCounter = 0;

// Helper: timestamped filenames
function getScreenshotPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  screenshotCounter++;
  return path.join(
    screenshotsDir,
    `${timestamp}_screenshot_${screenshotCounter}.png`
  );
}

// ========== Tools ==========
const takeScreenShot = tool({
  name: "take_screenshot",
  description:
    "Takes a screenshot of the current page and saves it locally, returns path",
  parameters: z.object({}),
  async execute() {
    const screenshotBuffer = await page.screenshot({ type: "png", fullPage: true });
    const filePath = getScreenshotPath();
    fs.writeFileSync(filePath, screenshotBuffer);
    console.log(`📸 Screenshot saved: ${filePath}`);
    return `Screenshot saved: ${filePath}`;
  },
});

const openURL = tool({
  name: "open_url",
  description: "Navigates to a specified URL",
  parameters: z.object({
    url: z.string().describe("The URL to navigate to"),
  }),
  async execute(input) {
    console.log(`🌐 Navigating to: ${input.url}`);
    await page.goto(input.url, { waitUntil: "networkidle", timeout: 30000 });
    const currentUrl = page.url();
    const title = await page.title();
    return `✅ Navigated to ${currentUrl}, Title: "${title}"`;
  },
});

const clickElement = tool({
  name: "click_element",
  description: "Clicks on an element using CSS selector",
  parameters: z.object({
    selector: z.string().describe("CSS selector of the element"),
  }),
  async execute(input) {
    console.log(`🎯 Clicking element: ${input.selector}`);
    await page.locator(input.selector).first().click({ timeout: 5000 });
    return `Clicked element: ${input.selector}`;
  },
});

const sendKeys = tool({
  name: "send_keys",
  description: "Types text into an element, optionally focusing first",
  parameters: z.object({
    text: z.string(),
    selector: z.string().nullable(),
  }),
  async execute(input) {
    if (input.selector) {
      await page.locator(input.selector).first().click({ timeout: 5000 });
    }
    await page.keyboard.type(input.text, { delay: 10 });
    return `Typed: "${input.text}"`;
  },
});

const clearAndType = tool({
  name: "clear_and_type",
  description: "Clears an input field and types new text quickly",
  parameters: z.object({
    selector: z.string(),
    text: z.string(),
  }),
  async execute(input) {
    const element = page.locator(input.selector).first();
    await element.click({ clickCount: 3, timeout: 5000 });
    await page.keyboard.press("Backspace");
    await element.type(input.text, { delay: 10 });
    return `✅ Typed "${input.text}" in ${input.selector}`;
  },
});

const waitForElement = tool({
  name: "wait_for_element",
  description: "Waits for an element to appear",
  parameters: z.object({
    selector: z.string(),
    timeout: z.number().nullable(),
  }),
  async execute(input) {
    const timeout = input.timeout || 5000;
    await page.locator(input.selector).first().waitFor({
      state: "visible",
      timeout,
    });
    return `Element ${input.selector} appeared`;
  },
});

const findSidebarLinks = tool({
  name: "find_sidebar_links",
  description: "Finds sidebar links in ChaiCode UI Vault",
  parameters: z.object({}),
  async execute() {
    const selectors = [
      "nav a",
      ".sidebar a",
      "aside a",
      'a:has-text("Sign Up")',
      'a:has-text("Login")',
    ];

    const results = [];
    for (const selector of selectors) {
      const elements = page.locator(selector);
      const count = await elements.count();
      if (count > 0) {
        for (let i = 0; i < Math.min(count, 3); i++) {
          const el = elements.nth(i);
          results.push({
            selector,
            text: (await el.textContent())?.trim(),
            href: await el.getAttribute("href"),
            isVisible: await el.isVisible(),
          });
        }
      }
    }
    return `Found sidebar links:\n${JSON.stringify(results, null, 2)}`;
  },
});

const clickSidebarItem = tool({
  name: "click_sidebar_item",
  description: "Clicks on a sidebar item by text",
  parameters: z.object({
    itemText: z.string(),
  }),
  async execute(input) {
    const locator = page.locator(`a:has-text("${input.itemText}")`).first();
    if (await locator.isVisible()) {
      await locator.click({ timeout: 5000 });
      return `Clicked sidebar item: ${input.itemText}`;
    }
    return `Sidebar item "${input.itemText}" not found`;
  },
});

// ========== Agent ==========
const websiteAutomationAgent = new Agent({
  name: "ChaiCode UI Vault Automation Agent",
  instructions: `
    Automate sign up flow on https://ui.chaicode.com:
    1. Take initial screenshot
    2. Navigate to site
    3. Screenshot after navigation
    4. Find sidebar links
    5. Click "Sign Up" sidebar item
    6. Screenshot sign-up form
    7. Fill form fields with clear_and_type:
       - First Name: Test
       - Last Name: User
       - Email: test@chaicode.com
       - Username: testuser123
       - Password: TestPassword123!
       - Confirm Password: TestPassword123!
       - Phone: +1234567890
    8. Submit form
    9. Take final screenshot
  `,
  tools: [
    takeScreenShot,
    openURL,
    clickElement,
    sendKeys,
    clearAndType,
    waitForElement,
    findSidebarLinks,
    clickSidebarItem,
  ],
});

// ========== Main ==========
async function executeAutomation() {
  try {
    console.log("🚀 Starting browser automation agent...");

    const result = await run(
      websiteAutomationAgent,
      [
        { role: "user", content: "Follow the exact steps in your instructions..." }
      ],
      {
        maxTurns: 40,
        apiKey: process.env.OPENAI_API_KEY,
      }
    );

    console.log("✅ Automation completed successfully!");
    console.log("📊 Final result:", result.finalOutput);
  } catch (error) {
    console.error("❌ Error during automation:", error);
    try {
      await takeScreenShot.execute({});
    } catch {}
  } finally {
    await browser.close();
    console.log("🌐 Browser closed");
  }
}

executeAutomation().catch(console.error);
