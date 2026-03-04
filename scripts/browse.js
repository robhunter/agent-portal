#!/usr/bin/env node
// Browse a URL headlessly and return content/screenshot
// Usage: NODE_PATH=$(npm root -g) node scripts/browse.js <url> [--screenshot <path>] [--selector <css>]

const { chromium } = require('playwright-core');

async function main() {
  const args = process.argv.slice(2);
  const url = args[0];
  if (!url) {
    console.error('Usage: browse.js <url> [--screenshot <path>] [--selector <css>] [--click <css>] [--type <css> <text>]');
    process.exit(1);
  }

  const screenshotIdx = args.indexOf('--screenshot');
  const screenshotPath = screenshotIdx >= 0 ? args[screenshotIdx + 1] : null;
  const selectorIdx = args.indexOf('--selector');
  const selector = selectorIdx >= 0 ? args[selectorIdx + 1] : null;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    if (screenshotPath) {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`Screenshot saved to ${screenshotPath}`);
    }

    if (selector) {
      const text = await page.locator(selector).allTextContents();
      console.log(text.join('\n'));
    } else {
      const title = await page.title();
      const text = await page.locator('body').innerText();
      console.log(`Title: ${title}\n\n${text.substring(0, 5000)}`);
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
}

main();
