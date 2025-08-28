import "dotenv/config";
import fs from "fs";
import path from "path";
import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { chromium } from "playwright";

// ================== Browser Launch ==================
const browser = await chromium.launch({
  headless: false,
  channel: "chrome",
  args: [
    "--disable-extensions",
    "--disable-file-system",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-web-security",
    "--allow-running-insecure-content",
  ],
});

const page = await browser.newPage();

// ================== Screenshot Setup ==================
const screenshotsDir = path.join(process.cwd(), "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}
let screenshotCounter = 0;

// ================== Helpers ==================
function getLocator(selector) {
  // Try on main page
  if (page.locator(selector)) {
    return page.locator(selector).first();
  }
  // Try first iframe
  const frame = page.frameLocator("iframe").first();
  return frame.locator(selector).first();
}

function getScreenshotPath() {
  screenshotCounter++;
  return path.join(
    screenshotsDir,
    `screenshot_${screenshotCounter.toString().padStart(3, "0")}.png`
  );
}

// ================== Tools ==================
const takeScreenShot = tool({
  name: "take_screenshot",
  description: "Takes a screenshot of the current page and saves it locally",
  parameters: z.object({}),
  async execute() {
    const screenshotBuffer = await page.screenshot({ type: "png", fullPage: true });
    const filePath = getScreenshotPath();
    fs.writeFileSync(filePath, screenshotBuffer);
    console.log(`📸 Screenshot saved: ${filePath}`);
    return filePath;
  },
});

const openURL = tool({
  name: "open_url",
  description: "Navigates to a specified URL",
  parameters: z.object({ url: z.string() }),
  async execute(input) {
    console.log(`🌐 Navigating to: ${input.url}`);
    await page.goto(input.url);
    await page.waitForLoadState("networkidle");
    return `Successfully navigated to ${input.url}`;
  },
});

const clickElement = tool({
  name: "click_element",
  description: "Clicks on an element using CSS selector or text (iframe-aware)",
  parameters: z.object({
    selector: z.string().describe("CSS selector OR visible text of the element"),
  }),
  async execute(input) {
    console.log(`🎯 Trying to click element: ${input.selector}`);
    try {
      let el = null;

      // Try CSS selector first (iframe-aware)
      try {
        el = getLocator(input.selector);
        await el.waitFor({ state: "visible", timeout: 5000 });
        await el.click();
        return `✅ Clicked element with selector: ${input.selector}`;
      } catch {
        console.log(`⚠️ Selector "${input.selector}" not found, trying text match...`);
      }

      // Fallback: try text-based click
      try {
        el = page.getByText(input.selector).first();
        await el.waitFor({ state: "visible", timeout: 5000 });
        await el.click();
        return `✅ Clicked element with text: "${input.selector}"`;
      } catch {
        console.log(`⚠️ Text match "${input.selector}" not found, trying inside iframe...`);
      }

      // Fallback: try inside first iframe
      try {
        const frame = page.frameLocator("iframe").first();
        el = frame.getByText(input.selector).first();
        await el.waitFor({ state: "visible", timeout: 5000 });
        await el.click();
        return `✅ Clicked element with text inside iframe: "${input.selector}"`;
      } catch (error) {
        console.log("❌ Final fallback failed, dumping iframe HTML...");
        const frame = page.frameLocator("iframe").first();
        const html = await frame.locator("body").innerHTML().catch(() => "");
        const filePath = path.join(screenshotsDir, "iframe_debug.html");
        fs.writeFileSync(filePath, html);
        return `❌ Failed to click element "${input.selector}". Dumped iframe HTML to ${filePath}`;
      }
    } catch (error) {
      return `❌ Error clicking element "${input.selector}": ${error.message}`;
    }
  },
});


const clearAndType = tool({
  name: "clear_and_type",
  description: "Clears an input field and types new text (iframe-aware)",
  parameters: z.object({ selector: z.string(), text: z.string() }),
  async execute(input) {
    console.log(`🧹 Clearing and typing in: ${input.selector}`);
    try {
      const el = getLocator(input.selector);
      await el.waitFor({ state: "visible", timeout: 10000 });
      await el.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await el.type(input.text, { delay: 10 });
      return `Typed "${input.text}" in ${input.selector}`;
    } catch (error) {
      return `Failed to clear and type in ${input.selector}: ${error.message}`;
    }
  },
});

const waitForElement = tool({
  name: "wait_for_element",
  description: "Waits for an element to appear (iframe-aware)",
  parameters: z.object({ selector: z.string(), timeout: z.number().nullable() }),
  async execute(input) {
    const timeout = input.timeout || 10000;
    console.log(`⏳ Waiting for element: ${input.selector}`);
    try {
      const el = getLocator(input.selector);
      await el.waitFor({ state: "visible", timeout });
      return `Element ${input.selector} appeared`;
    } catch (error) {
      return `Element ${input.selector} did not appear in ${timeout}ms`;
    }
  },
});

const findElements = tool({
  name: "find_elements",
  description: "Finds elements and returns count + text (iframe-aware)",
  parameters: z.object({ selector: z.string() }),
  async execute(input) {
    console.log(`🔍 Finding elements: ${input.selector}`);
    try {
      const el = getLocator(input.selector);
      const count = await el.count();
      if (count === 0) return `No elements found for ${input.selector}`;

      const results = [];
      for (let i = 0; i < Math.min(count, 5); i++) {
        const element = el.nth(i);
        const text = await element.textContent().catch(() => "");
        results.push({ index: i, text: text?.trim() || "" });
      }
      return `Found ${count} elements:\n${JSON.stringify(results, null, 2)}`;
    } catch (error) {
      return `Error finding elements: ${error.message}`;
    }
  },
});

const dumpIframeHTML = tool({
  name: "dump_iframe_html",
  description: "Saves the first iframe's HTML for debugging",
  parameters: z.object({}),
  async execute() {
    try {
      const frame = page.frameLocator("iframe").first();
      const html = await frame.locator("body").innerHTML();
      const filePath = path.join(screenshotsDir, "iframe_debug.html");
      fs.writeFileSync(filePath, html);
      return `Iframe HTML saved to ${filePath}`;
    } catch (error) {
      return `Failed to dump iframe HTML: ${error.message}`;
    }
  },
});

// ================== Agent ==================
const websiteAutomationAgent = new Agent({
  name: "Website Automation Agent",
  instructions: `
    Navigate to https://ui.chaicode.com and complete the sign-up form.

    Steps:
    1. Take an initial screenshot.
    2. Navigate to https://ui.chaicode.com.
    3. Take a screenshot.
    4. Click the "Sign Up" sidebar link.
    5. Take a screenshot of the sign-up page.
    6. Use find_elements to verify inputs inside iframe.
    7. If inputs not found, run dump_iframe_html for debugging.
    8. Fill form fields:
       - First Name: Test
       - Last Name: User
       - Email: test@example.com
       - Username: testuser123
       - Password: TestPassword123!
       - Confirm Password: TestPassword123!
       - Phone: +1234567890
    9. Submit form by clicking 'button[type="submit"]'.
    10. Take final screenshot.

    Rules:
    - Always use wait_for_element before interacting.
    - Use clear_and_type for inputs.
    - Take screenshots at every step.
    - If selectors fail, use dump_iframe_html for debugging.
  `,
  tools: [
    takeScreenShot,
    openURL,
    clickElement,
    clearAndType,
    waitForElement,
    findElements,
    dumpIframeHTML,
  ],
});

// ================== Main Execution ==================
async function executeAutomation() {
  try {
    console.log("🚀 Starting automation...");
    console.log("📁 Screenshots will be saved to:", screenshotsDir);

    const result = await run(
      websiteAutomationAgent,
      "Start the sign-up automation flow.",
      { maxTurns: 30 }
    );

    console.log("✅ Automation completed!");
    console.log("📊 Final result:", result.finalOutput);
  } catch (error) {
    console.error("❌ Error:", error);
    try {
      await takeScreenShot.execute({});
    } catch { }
  } finally {
    console.log("🔍 Keeping browser open for 5s...");
    await new Promise((res) => setTimeout(res, 5000));
    await browser.close();
    console.log("🌐 Browser closed");
  }
}

// Run
console.log("🎬 Starting automation in 3s...");
setTimeout(() => executeAutomation().catch(console.error), 3000);
