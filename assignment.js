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
    return `Screenshot saved: ${filePath}`;
  },
});

const openURL = tool({
  name: "open_url",
  description: "Navigates to a specified URL",
  parameters: z.object({ url: z.string() }),
  async execute(input) {
    console.log(`🌐 Navigating to: ${input.url}`);
    await page.goto(input.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    return `Successfully navigated to ${input.url}`;
  },
});

const analyzeFormFields = tool({
  name: "analyze_form_fields",
  description: "Analyzes all input fields on the page to understand the form structure",
  parameters: z.object({}),
  async execute() {
    console.log(`🔍 Analyzing form fields...`);
    try {
      let results = [];

      // Check main page inputs
      try {
        const inputs = await page.locator('input').all();
        for (let i = 0; i < inputs.length; i++) {
          const input = inputs[i];
          const placeholder = await input.getAttribute("placeholder").catch(() => "");
          const name = await input.getAttribute("name").catch(() => "");
          const id = await input.getAttribute("id").catch(() => "");
          const type = await input.getAttribute("type").catch(() => "text");
          const value = await input.inputValue().catch(() => "");

          results.push({
            location: "main page",
            index: i,
            placeholder,
            name,
            id,
            type,
            currentValue: value,
            selector: `input:nth-of-type(${i + 1})`
          });
        }
      } catch (e) {
        console.log("No inputs on main page");
      }

      // Check iframe inputs
      try {
        const frame = page.frameLocator("iframe").first();
        const inputs = await frame.locator('input').all();
        for (let i = 0; i < inputs.length; i++) {
          const input = inputs[i];
          const placeholder = await input.getAttribute("placeholder").catch(() => "");
          const name = await input.getAttribute("name").catch(() => "");
          const id = await input.getAttribute("id").catch(() => "");
          const type = await input.getAttribute("type").catch(() => "text");
          const value = await input.inputValue().catch(() => "");

          results.push({
            location: "iframe",
            index: i,
            placeholder,
            name,
            id,
            type,
            currentValue: value,
            selector: `input:nth-of-type(${i + 1})`
          });
        }
      } catch (e) {
        console.log("No inputs in iframe");
      }

      return `Found ${results.length} form fields:\n${JSON.stringify(results, null, 2)}`;
    } catch (error) {
      return `Error analyzing form: ${error.message}`;
    }
  },
});

const fillSpecificField = tool({
  name: "fill_specific_field",
  description: "Fills a specific form field using multiple targeting strategies",
  parameters: z.object({
    fieldType: z.string().describe("Type of field: firstName, lastName, email, password, confirmPassword"),
    value: z.string().describe("Value to fill"),
    location: z.string().nullable().describe("main page or iframe, or null for both")
  }),
  async execute(input) {
    console.log(`✏️ Filling ${input.fieldType} with: ${input.value}`);

    const strategies = {
      firstName: [
        'input[placeholder*="First" i]',
        'input[name*="first" i]',
        'input[id*="first" i]',
        'input:nth-of-type(1)',  // Usually first text input
      ],
      lastName: [
        'input[placeholder*="Last" i]',
        'input[name*="last" i]',
        'input[id*="last" i]',
        'input:nth-of-type(2)',  // Usually second text input
      ],
      email: [
        'input[type="email"]',
        'input[placeholder*="email" i]',
        'input[name*="email" i]',
        'input[id*="email" i]',
      ],
      password: [
        'input[type="password"]:nth-of-type(1)',
        'input[type="password"]:first',
        'input[placeholder*="password" i]:first',
        'input[name*="password" i]:first',
      ],
      confirmPassword: [
        'input[type="password"]:nth-of-type(2)',
        'input[type="password"]:nth(1)',  // Second password field (0-indexed)
        'input[type="password"]:last',
        'input[placeholder*="confirm" i]',
        'input[placeholder*="repeat" i]',
        'input[name*="confirm" i]',
        'input[name*="repeat" i]',
        'input[id*="confirm" i]',
        'input[id*="repeat" i]',
        // Try by position - often confirm password is right after password
        'input[type="password"] + input[type="password"]',
        // Generic fallback - get all password inputs and take the second one
        'input[type="password"]',
      ]
    };

    const selectors = strategies[input.fieldType] || ['input'];

    // Special handling for confirmPassword - try to get the second password field specifically
    if (input.fieldType === 'confirmPassword') {
      // First, try to find all password fields and target the second one specifically
      try {
        // Try main page first
        if (!input.location || input.location === "main page") {
          const passwordFields = await page.locator('input[type="password"]').all();
          if (passwordFields.length >= 2) {
            const confirmField = passwordFields[1]; // Second password field
            await confirmField.click();
            await confirmField.selectText().catch(() => { });
            await page.keyboard.press("Delete");
            await page.waitForTimeout(300);
            await confirmField.fill(input.value);
            await page.waitForTimeout(300);

            const currentValue = await confirmField.inputValue();
            if (currentValue === input.value) {
              return `✅ Successfully filled confirmPassword on main page (second password field)`;
            }
          }
        }

        // Try iframe
        if (!input.location || input.location === "iframe") {
          const frame = page.frameLocator("iframe").first();
          const passwordFields = await frame.locator('input[type="password"]').all();
          if (passwordFields.length >= 2) {
            const confirmField = passwordFields[1]; // Second password field
            await confirmField.click();
            await confirmField.selectText().catch(() => { });
            await page.keyboard.press("Delete");
            await page.waitForTimeout(300);
            await confirmField.fill(input.value);
            await page.waitForTimeout(300);

            const currentValue = await confirmField.inputValue();
            if (currentValue === input.value) {
              return `✅ Successfully filled confirmPassword in iframe (second password field)`;
            }
          }
        }
      } catch (e) {
        console.log("Special confirmPassword handling failed, trying regular selectors...");
      }
    }

    for (const selector of selectors) {
      try {
        // Try main page first
        if (!input.location || input.location === "main page") {
          try {
            let element;

            // For confirmPassword, if using generic password selector, get the second one
            if (input.fieldType === 'confirmPassword' && selector === 'input[type="password"]') {
              const passwordFields = await page.locator(selector).all();
              if (passwordFields.length >= 2) {
                element = passwordFields[1]; // Second password field
              } else {
                continue; // Skip this strategy if not enough password fields
              }
            } else {
              element = page.locator(selector).first();
            }

            await element.waitFor({ state: "visible", timeout: 5000 });

            // Clear the field completely
            await element.click();
            await element.selectText().catch(() => { });
            await page.keyboard.press("Delete");
            await page.waitForTimeout(300);

            // Fill with new value
            await element.fill(input.value);
            await page.waitForTimeout(300);

            // Verify the value was set correctly
            const currentValue = await element.inputValue();
            if (currentValue === input.value) {
              return `✅ Successfully filled ${input.fieldType} on main page using: ${selector}`;
            }
          } catch (e) {
            console.log(`Failed main page selector: ${selector}`);
          }
        }

        // Try iframe
        if (!input.location || input.location === "iframe") {
          try {
            const frame = page.frameLocator("iframe").first();
            let element;

            // For confirmPassword, if using generic password selector, get the second one
            if (input.fieldType === 'confirmPassword' && selector === 'input[type="password"]') {
              const passwordFields = await frame.locator(selector).all();
              if (passwordFields.length >= 2) {
                element = passwordFields[1]; // Second password field
              } else {
                continue; // Skip this strategy if not enough password fields
              }
            } else {
              element = frame.locator(selector).first();
            }

            await element.waitFor({ state: "visible", timeout: 5000 });

            // Clear the field completely
            await element.click();
            await element.selectText().catch(() => { });
            await page.keyboard.press("Delete");
            await page.waitForTimeout(300);

            // Fill with new value
            await element.fill(input.value);
            await page.waitForTimeout(300);

            // Verify the value was set correctly
            const currentValue = await element.inputValue();
            if (currentValue === input.value) {
              return `✅ Successfully filled ${input.fieldType} in iframe using: ${selector}`;
            }
          } catch (e) {
            console.log(`Failed iframe selector: ${selector}`);
          }
        }
      } catch (error) {
        console.log(`Error with selector ${selector}: ${error.message}`);
        continue;
      }
    }

    return `❌ Failed to fill ${input.fieldType} with any selector strategy`;
  },
});

const clickElement = tool({
  name: "click_element",
  description: "Clicks on an element using CSS selector or text",
  parameters: z.object({
    selector: z.string().describe("CSS selector OR visible text of the element"),
  }),
  async execute(input) {
    console.log(`🎯 Clicking element: ${input.selector}`);

    const strategies = [
      // CSS selector on main page
      () => page.locator(input.selector).first().click(),
      // Text match on main page
      () => page.getByText(input.selector, { exact: false }).first().click(),
      // CSS selector in iframe
      () => page.frameLocator("iframe").first().locator(input.selector).first().click(),
      // Text match in iframe
      () => page.frameLocator("iframe").first().getByText(input.selector, { exact: false }).first().click(),
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        await strategies[i]();
        await page.waitForTimeout(1000);
        return `✅ Successfully clicked: ${input.selector} (strategy ${i + 1})`;
      } catch (error) {
        console.log(`Strategy ${i + 1} failed: ${error.message}`);
      }
    }

    return `❌ Failed to click element: ${input.selector}`;
  },
});

const submitForm = tool({
  name: "submit_form",
  description: "Submits the form using various submit button strategies",
  parameters: z.object({}),
  async execute() {
    console.log(`📤 Attempting to submit form...`);

    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Sign Up")',
      'button:has-text("Create Account")',
      'button:has-text("Submit")',
      'button:has-text("Register")',
      '[role="button"]:has-text("Sign Up")',
    ];

    // Wait a moment before submitting
    await page.waitForTimeout(2000);

    for (const selector of submitSelectors) {
      try {
        // Try main page
        try {
          const button = page.locator(selector).first();
          await button.waitFor({ state: "visible", timeout: 3000 });
          await button.click();
          await page.waitForTimeout(2000);
          return `✅ Form submitted using main page selector: ${selector}`;
        } catch { }

        // Try iframe
        try {
          const frame = page.frameLocator("iframe").first();
          const button = frame.locator(selector).first();
          await button.waitFor({ state: "visible", timeout: 3000 });
          await button.click();
          await page.waitForTimeout(2000);
          return `✅ Form submitted using iframe selector: ${selector}`;
        } catch { }

      } catch (error) {
        console.log(`Submit selector failed: ${selector}`);
      }
    }

    return `❌ Could not find any submit button to click`;
  },
});

// ================== Agent ==================
const websiteAutomationAgent = new Agent({
  name: "Precise Form Filling Agent",
  instructions: `
    You are an expert at filling web forms precisely. Your task is to navigate to https://ui.chaicode.com and complete the sign-up form accurately.

    STEP-BY-STEP PROCESS:
    1. Take initial screenshot
    2. Navigate to https://ui.chaicode.com
    3. Wait for page to load, then take screenshot
    4. IMPORTANT: Click "Sign Up" in the sidebar to navigate to the actual sign-up form
    5. Take screenshot after clicking Sign Up to verify you're on the form page
    6. Use analyze_form_fields to understand the form structure completely
    7. ONLY proceed with filling if form fields are found. If no fields found, stop and report the issue.
    8. Fill each field individually using fill_specific_field with these exact values:
       - firstName: "Test"
       - lastName: "User"
       - email: "test@example.com"
       - password: "TestPassword123!"
       - confirmPassword: "TestPassword123!"
    9. Take a screenshot after filling each field to verify correct placement
    10. Use submit_form to submit the form
    11. Take final screenshot to see the result
    12. Wait 3 seconds to observe any success messages

    CRITICAL RULES:
    - You MUST click "Sign Up" in the sidebar first to get to the actual form
    - Always analyze the form structure first before filling
    - Fill ONE field at a time using fill_specific_field
    - Take screenshots between each field to verify correct filling
    - If no form fields are found after clicking Sign Up, report this immediately
    - If a field fills incorrectly, the tool will try alternative selectors
    - Be patient - wait for elements to load before interacting
    - Verify each field was filled correctly before moving to the next
  `,
  tools: [
    takeScreenShot,
    openURL,
    analyzeFormFields,
    fillSpecificField,
    clickElement,
    submitForm,
  ],
});

// ================== Main Execution ==================
async function executeAutomation() {
  try {
    console.log("🚀 Starting precise form automation...");
    console.log("📁 Screenshots will be saved to:", screenshotsDir);

    const result = await run(
      websiteAutomationAgent,
      "Begin the precise sign-up form automation. IMPORTANT: You must click 'Sign Up' in the sidebar first to navigate to the actual form, then analyze and fill it carefully.",
      { maxTurns: 50 }
    );

    console.log("✅ Automation completed!");
    console.log("📊 Final result:", result.finalOutput);
  } catch (error) {
    console.error("❌ Error:", error);
    try {
      await takeScreenShot.execute({});
    } catch { }
  } finally {
    console.log("🔍 Keeping browser open for 15 seconds to review results...");
    await new Promise((resolve) => setTimeout(resolve, 15000));
    await browser.close();
    console.log("🌐 Browser closed");
  }
}

// ================== Start Automation ==================
console.log("🎬 Starting automation in 3 seconds...");
setTimeout(() => executeAutomation().catch(console.error), 3000);