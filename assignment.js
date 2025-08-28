import "dotenv/config";
import fs from "fs";
import path from "path";
import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { chromium } from "playwright";

// Launch browser using Chrome
const browser = await chromium.launch({
  headless: false,
  channel: 'chrome', // This will use your installed Chrome browser
  args: [
    '--disable-extensions',
    '--disable-file-system',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-web-security',
    '--allow-running-insecure-content'
  ],
});

const page = await browser.newPage();

// ================== Screenshot Setup ==================
const screenshotsDir = path.join(process.cwd(), "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}
let screenshotCounter = 0;

// ================== Tools ==================
const takeScreenShot = tool({
  name: "take_screenshot",
  description: "Takes a screenshot of the current page and saves it locally, returns base64 encoded image",
  parameters: z.object({}),
  async execute() {
    const screenshotBuffer = await page.screenshot({ type: "png", fullPage: true });
    screenshotCounter++;
    const filePath = path.join(
      screenshotsDir,
      `screenshot_${screenshotCounter.toString().padStart(3, '0')}.png`
    );
    fs.writeFileSync(filePath, screenshotBuffer);
    console.log(`📸 Screenshot saved: ${filePath}`);
    return `Screenshot ${screenshotCounter} taken and saved to ${filePath}`;
  },
});

const openURL = tool({
  name: "open_url",
  description: "Navigates to a specified URL and waits for it to load completely",
  parameters: z.object({
    url: z.string().describe("The URL to navigate to"),
  }),
  async execute(input) {
    console.log(`🌐 Navigating to: ${input.url}`);
    try {
      await page.goto(input.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(3000); // Extra wait for any dynamic content

      const currentUrl = page.url();
      const title = await page.title();

      console.log(`✅ Successfully loaded: ${currentUrl}`);
      console.log(`📄 Page title: ${title}`);

      return `Successfully navigated to ${input.url}. Current URL: ${currentUrl}. Page title: "${title}". Page is ready for interaction.`;
    } catch (error) {
      console.log(`❌ Navigation failed: ${error.message}`);
      return `Failed to navigate to ${input.url}: ${error.message}. Please try again or check if the URL is correct.`;
    }
  },
});

const clickOnScreen = tool({
  name: "click_screen",
  description: "Clicks on the screen with specified coordinates",
  parameters: z.object({
    x: z.number().describe("X coordinate to click"),
    y: z.number().describe("Y coordinate to click"),
  }),
  async execute(input) {
    console.log(`🖱️ Clicking at coordinates (${input.x}, ${input.y})`);
    await page.mouse.click(input.x, input.y);
    await page.waitForTimeout(1500);
    return `Clicked at coordinates (${input.x}, ${input.y})`;
  },
});

const clickElement = tool({
  name: "click_element",
  description: "Clicks on an element using CSS selector",
  parameters: z.object({
    selector: z.string().describe("CSS selector of the element to click"),
  }),
  async execute(input) {
    console.log(`🎯 Clicking element: ${input.selector}`);
    try {
      await page.locator(input.selector).first().click();
      await page.waitForTimeout(1500);
      return `Successfully clicked element: ${input.selector}`;
    } catch (error) {
      return `Failed to click element ${input.selector}: ${error.message}`;
    }
  },
});

const sendKeys = tool({
  name: "send_keys",
  description: "Types text into an element, optionally focusing on it first",
  parameters: z.object({
    text: z.string().describe("The text to type"),
    selector: z.string().nullable().describe("CSS selector to focus on before typing (null if already focused)"),
  }),
  async execute(input) {
    console.log(`⌨️ Typing: "${input.text}"`);
    try {
      if (input.selector) {
        await page.locator(input.selector).first().click();
        await page.waitForTimeout(500);
      }
      await page.keyboard.type(input.text, { delay: 100 });
      await page.waitForTimeout(1000);
      return `Successfully typed: "${input.text}"`;
    } catch (error) {
      return `Failed to type text: ${error.message}`;
    }
  },
});

const clearAndType = tool({
  name: "clear_and_type",
  description: "Clears an input field and types new text quickly",
  parameters: z.object({
    selector: z.string().describe("CSS selector of the input field"),
    text: z.string().describe("Text to type after clearing"),
  }),
  async execute(input) {
    console.log(`🧹 Clearing and typing in: ${input.selector}`);
    try {
      const element = page.locator(input.selector).first();

      // Focus and clear the input
      await element.click({ clickCount: 3 }); // triple-click selects all text
      await page.keyboard.press("Backspace");

      // Type new text without artificial delay
      await element.type(input.text, { delay: 10 });

      return `✅ Typed "${input.text}" in ${input.selector}`;
    } catch (error) {
      return `❌ Failed to clear and type in ${input.selector}: ${error.message}`;
    }
  },
});


const scroll = tool({
  name: "scroll",
  description: "Scrolls the page in a specified direction",
  parameters: z.object({
    direction: z.enum(["up", "down", "left", "right"]).describe("Direction to scroll"),
    pixels: z.number().nullable().describe("Number of pixels to scroll (null for default 300)"),
  }),
  async execute(input) {
    const scrollAmount = input.pixels || 300;
    let deltaX = 0;
    let deltaY = 0;

    switch (input.direction) {
      case "up":
        deltaY = -scrollAmount;
        break;
      case "down":
        deltaY = scrollAmount;
        break;
      case "left":
        deltaX = -scrollAmount;
        break;
      case "right":
        deltaX = scrollAmount;
        break;
    }

    console.log(`📜 Scrolling ${input.direction} by ${scrollAmount}px`);
    await page.mouse.wheel(deltaX, deltaY);
    await page.waitForTimeout(1000);
    return `Scrolled ${input.direction} by ${scrollAmount} pixels`;
  },
});

const findElements = tool({
  name: "find_elements",
  description: "Finds elements on the page by selector and returns their properties and locations",
  parameters: z.object({
    selector: z.string().describe("CSS selector to find elements"),
    property: z.string().nullable().describe("Property to get from elements (text, value, href, etc.) - null for basic info"),
  }),
  async execute(input) {
    console.log(`🔍 Finding elements: ${input.selector}`);
    try {
      const elements = page.locator(input.selector);
      const count = await elements.count();

      if (count === 0) {
        return `No elements found with selector: ${input.selector}`;
      }

      const results = [];
      for (let i = 0; i < Math.min(count, 5); i++) { // Limit to first 5 elements
        const element = elements.nth(i);
        const isVisible = await element.isVisible().catch(() => false);
        const boundingBox = await element.boundingBox().catch(() => null);

        let result = {
          index: i,
          selector: input.selector,
          isVisible,
          boundingBox,
        };

        if (input.property && isVisible) {
          const propertyValue = await element.getAttribute(input.property).catch(() => null) ||
            await element.textContent().catch(() => null);
          result.propertyValue = propertyValue;
        } else if (isVisible) {
          const text = await element.textContent().catch(() => '');
          result.text = text?.trim() || '';
        }

        results.push(result);
      }

      return `Found ${count} elements. Details:\n${JSON.stringify(results, null, 2)}`;
    } catch (error) {
      return `Error finding elements: ${error.message}`;
    }
  },
});

const waitForElement = tool({
  name: "wait_for_element",
  description: "Waits for an element to appear on the page",
  parameters: z.object({
    selector: z.string().describe("CSS selector to wait for"),
    timeout: z.number().nullable().describe("Timeout in milliseconds (null for default 5000)"),
  }),
  async execute(input) {
    const timeout = input.timeout || 5000;
    console.log(`⏳ Waiting for element: ${input.selector}`);
    try {
      await page.locator(input.selector).first().waitFor({
        state: 'visible',
        timeout
      });
      return `Element ${input.selector} appeared within ${timeout}ms`;
    } catch (error) {
      return `Element ${input.selector} did not appear within ${timeout}ms`;
    }
  },
});

const getPageInfo = tool({
  name: "get_page_info",
  description: "Gets basic information about the current page",
  parameters: z.object({}),
  async execute() {
    try {
      const url = page.url();
      const title = await page.title();
      const viewport = page.viewportSize();

      return `Current page info:
- URL: ${url}
- Title: ${title}
- Viewport: ${viewport?.width}x${viewport?.height}`;
    } catch (error) {
      return `Error getting page info: ${error.message}`;
    }
  },
});

const findSidebarLinks = tool({
  name: "find_sidebar_links",
  description: "Specifically finds sidebar navigation links in the ChaiCode UI Vault",
  parameters: z.object({}),
  async execute() {
    console.log("🔍 Looking for sidebar navigation links...");
    try {
      // Try multiple selectors for sidebar links
      const selectors = [
        'nav a', // Navigation links
        '.sidebar a', // Sidebar class links
        '[data-testid*="sidebar"] a', // Test ID sidebar links
        'aside a', // Aside element links
        'a[href*="sign-up"]', // Direct sign-up links
        'a[href*="login"]', // Direct login links
        'a:contains("Sign Up")', // Text-based search
        'a:contains("Login")', // Text-based search
      ];

      const results = [];

      for (const selector of selectors) {
        try {
          const elements = page.locator(selector);
          const count = await elements.count();

          if (count > 0) {
            console.log(`Found ${count} elements with selector: ${selector}`);

            for (let i = 0; i < Math.min(count, 3); i++) {
              const element = elements.nth(i);
              const text = await element.textContent().catch(() => '');
              const href = await element.getAttribute('href').catch(() => '');
              const boundingBox = await element.boundingBox().catch(() => null);

              results.push({
                selector,
                index: i,
                text: text?.trim(),
                href,
                boundingBox,
                isVisible: await element.isVisible().catch(() => false)
              });
            }
          }
        } catch (error) {
          // Skip selectors that don't work
        }
      }

      return `Sidebar analysis complete. Found ${results.length} navigation elements:\n${JSON.stringify(results, null, 2)}`;
    } catch (error) {
      return `Error analyzing sidebar: ${error.message}`;
    }
  },
});

const clickSidebarItem = tool({
  name: "click_sidebar_item",
  description: "Clicks on a specific item in the sidebar by text content",
  parameters: z.object({
    itemText: z.string().describe("Text content of the sidebar item to click (e.g., 'Sign Up', 'Login')"),
  }),
  async execute(input) {
    console.log(`🎯 Looking for sidebar item: "${input.itemText}"`);
    try {
      // Try multiple approaches to find and click the sidebar item
      const selectors = [
        `a:text("${input.itemText}")`, // Playwright text selector
        `button:text("${input.itemText}")`,
        `[role="menuitem"]:text("${input.itemText}")`,
        `nav a:has-text("${input.itemText}")`,
        `.sidebar a:has-text("${input.itemText}")`,
        `aside a:has-text("${input.itemText}")`,
      ];

      for (const selector of selectors) {
        try {
          const element = page.locator(selector).first();
          if (await element.isVisible()) {
            await element.click();
            await page.waitForTimeout(2000);
            return `Successfully clicked sidebar item: "${input.itemText}" using selector: ${selector}`;
          }
        } catch (error) {
          // Try next selector
          continue;
        }
      }

      return `Could not find clickable sidebar item: "${input.itemText}"`;
    } catch (error) {
      return `Error clicking sidebar item: ${error.message}`;
    }
  },
});

// ================== Agent ==================
const websiteAutomationAgent = new Agent({
  name: "ChaiCode UI Vault Automation Agent",
  instructions: `
    You are a website automation agent specialized in navigating the ChaiCode UI Vault interface.
    
    CRITICAL: You must complete the ENTIRE task, not just navigation. Do not stop after opening a URL.
    
    MANDATORY SEQUENCE - COMPLETE ALL STEPS:
    1. Take screenshot to see current browser state
    2. Navigate to https://ui.chaicode.com using open_url tool
    3. Take screenshot after navigation to confirm page loaded
    4. Use find_sidebar_links to analyze the sidebar structure
    5. Use get_page_info to understand the current page
    6. Use click_sidebar_item to click "Sign Up" in the sidebar
    7. Take screenshot to see the sign up form
    8. Fill out the sign up form using clear_and_type for each field:
       - First Name: Test  
       - Last Name: User
       - Email: test@chaicode.com
       - Username: testuser123
       - Password: TestPassword123!
       - Confirm Password: TestPassword123!
       - Phone: +1234567890
    9. Submit the form using click_element
    10. Take final screenshot to document results
    
    IMPORTANT RULES:
    - NEVER stop after just navigating to a URL
    - ALWAYS continue with the form interaction
    - Take screenshots after EVERY major step
    - If a step fails, try alternative approaches and continue
    - Use specific tools: find_sidebar_links, click_sidebar_item, clear_and_type
    - Complete the ENTIRE automation task
    - If you encounter errors, document them but keep trying
    
    SUCCESS CRITERIA:
    You have NOT completed the task until you have:
    ✅ Navigated to ui.chaicode.com
    ✅ Found and clicked Sign Up in sidebar
    ✅ Filled out the sign up form
    ✅ Submitted the form
    ✅ Documented with screenshots
  `,
  tools: [
    takeScreenShot,
    openURL,
    clickOnScreen,
    clickElement,
    sendKeys,
    clearAndType,
    scroll,
    findElements,
    waitForElement,
    getPageInfo,
    findSidebarLinks,
    clickSidebarItem,
  ],
});

// ================== Main Execution ==================
async function executeAutomation() {
  try {
    console.log("🚀 Starting browser automation agent...");
    console.log("📁 Screenshots will be saved to:", screenshotsDir);

    const result = await run(
      websiteAutomationAgent,
      "You are tasked with automating the ChaiCode UI Vault. Follow these exact steps in order: 1) Take a screenshot of current browser state, 2) Navigate to 'https://ui.chaicode.com' using open_url tool, 3) Take another screenshot after navigation, 4) Use find_sidebar_links to analyze the page structure, 5) Click on 'Sign Up' in the sidebar using click_sidebar_item tool, 6) Fill out and submit the sign up form. Continue until task is complete and don't stop after navigation.",
      {
        maxTurns: 40 // Further increased to ensure completion
      }
    );

    console.log("✅ Automation completed successfully!");
    console.log("📊 Final result:", result.finalOutput);

  } catch (error) {
    console.error("❌ Error during automation:", error);

    // Take a final screenshot on error
    try {
      await takeScreenShot.execute({});
      console.log("📸 Error screenshot taken");
    } catch (screenshotError) {
      console.error("Failed to take error screenshot:", screenshotError);
    }
  } finally {
    // Keep browser open for a moment to see final state
    console.log("🔍 Keeping browser open for 5 seconds to view final state...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    await browser.close();
    console.log("🌐 Browser closed");
    console.log(`📸 Total screenshots taken: ${screenshotCounter}`);
    console.log(`📁 Screenshots saved in: ${screenshotsDir}`);
  }
}

// Run the automation
console.log("🎬 Starting automation in 3 seconds...");
setTimeout(() => {
  executeAutomation().catch(console.error);
}, 3000);