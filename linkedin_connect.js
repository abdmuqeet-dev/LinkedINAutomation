/**
 * LinkedIn Connection Automator (Playwright)
 * Target: Software / AI/ML roles in the United States
 * Limit: 20 requests per run (safe for testing)
 *
 * Usage:
 *   npm install playwright
 *   npx playwright install chromium
 *   node linkedin_connect.js
 */

const { chromium } = require('playwright');
const fs = require('fs');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CONFIG = {
  email:    'email',
  password: 'password',

  targetCount: 20,

  // Personalized note ({firstName} gets replaced). Set to null to skip note.
  note: null,

  keywords: 'software engineer AI ML',
  location: 'United States',

  // Conservative delays (ms)
  delayMin:  8000,
  delayMax:  18000,
  pageDelay: 6000,

  logFile: './connection_log.json',
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function buildSearchUrl(pageNum = 1) {
  // Exact URL format confirmed from debug HTML
  const params = new URLSearchParams({
    keywords:   CONFIG.keywords,
    origin:     'GLOBAL_SEARCH_HEADER',
    network:    '["S","O"]',
    geoUrn:     '"urn:li:geo:103644278"',
    page:       String(pageNum),
  });
  return `https://www.linkedin.com/search/results/people/?${params}`;
}

function personalizeNote(note, firstName) {
  return note.replace('{firstName}', firstName || 'there');
}

async function randomDelay() {
  const ms = rand(CONFIG.delayMin, CONFIG.delayMax);
  console.log(`  ⏱  Waiting ${(ms / 1000).toFixed(1)}s...`);
  await sleep(ms);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

(async () => {
  const log = { date: new Date().toISOString(), sent: [], skipped: [], errors: [] };

  console.log('🚀 Starting LinkedIn Connection Automator');
  console.log(`   Target: ${CONFIG.targetCount} requests\n`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // ── 1. Log in ──────────────────────────────────────────────────────────────
  console.log('🔐 Logging in...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.fill('#username', CONFIG.email);
  await sleep(rand(500, 1200));
  await page.fill('#password', CONFIG.password);
  await sleep(rand(400, 900));
  await page.click('button[type="submit"]');

  await page.waitForURL('**/feed**', { timeout: 30000 }).catch(() => {
    console.warn('⚠  Did not land on feed — complete any CAPTCHA/2FA in the browser window.');
  });

  await sleep(rand(4000, 7000));
  console.log('✅ Logged in\n');

  // ── 2. Warm-up: browse feed naturally ─────────────────────────────────────
  console.log('🌀 Warming up — browsing feed briefly...');
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(rand(5000, 9000));
  await page.mouse.wheel(0, rand(300, 700));
  await sleep(rand(3000, 6000));
  await page.mouse.wheel(0, rand(200, 500));
  await sleep(rand(4000, 7000));
  console.log('✅ Warm-up done\n');

  // ── 3. Search and connect ──────────────────────────────────────────────────
  let sentCount = 0;
  let searchPage = 1;

  while (sentCount < CONFIG.targetCount) {
    const url = buildSearchUrl(searchPage);
    console.log(`📄 Loading search page ${searchPage}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(CONFIG.pageDelay);

    // Scroll to trigger lazy loading
    await page.mouse.wheel(0, 400);
    await sleep(1500);

    // ── KEY: Connect buttons in LinkedIn's current HTML are <a> tags
    //    with href="/preload/search-custom-invite/?vanityName=..."
    //    and aria-label="Invite [Name] to connect"
    const connectLinks = await page.$$('a[href*="/preload/search-custom-invite/"]');

    if (connectLinks.length === 0) {
      console.log(`  ⚠  No Connect links found on page ${searchPage}. Moving to next page...`);
      searchPage++;
      if (searchPage > 10) { console.log('Reached page limit. Stopping.'); break; }
      continue;
    }

    console.log(`   Found ${connectLinks.length} connectable profiles\n`);

    for (const connectLink of connectLinks) {
      if (sentCount >= CONFIG.targetCount) break;

      // Extract name from aria-label: "Invite John Smith to connect"
      let fullName = '(unknown)';
      let firstName = '';
      try {
        const ariaLabel = await connectLink.getAttribute('aria-label') || '';
        const match = ariaLabel.match(/^Invite\s+(.+?)\s+to connect$/i);
        if (match) fullName = match[1].trim();
        firstName = fullName.split(' ')[0] || '';
      } catch (_) {}

      try {
        await connectLink.click();
        await sleep(rand(1000, 2000));

        // Handle "How do you know X?" screen if it appears
        const otherBtn = await page.$('button[aria-label="Other"]');
        if (otherBtn) {
          await otherBtn.click();
          await sleep(rand(500, 1000));
        }

        // Add a note if configured
        if (CONFIG.note) {
          const addNoteBtn = await page.$('button:has-text("Add a note"), [aria-label="Add a note"]');
          if (addNoteBtn) {
            await addNoteBtn.click();
            await sleep(rand(600, 1200));
            const textarea = await page.$('textarea[name="message"], #custom-message, textarea');
            if (textarea) {
              await textarea.fill(personalizeNote(CONFIG.note, firstName));
              await sleep(rand(800, 1500));
            }
          }
        }

        // Click Send
        const sendBtn = await page.$(
          'button:has-text("Send"), button:has-text("Send invitation"), [aria-label="Send invitation"]'
        );

        if (sendBtn) {
          await sendBtn.click();
          sentCount++;
          console.log(`  ✉  [${sentCount}/${CONFIG.targetCount}] Sent to: ${fullName}`);
          log.sent.push({ name: fullName, timestamp: new Date().toISOString() });

          // Mid-run break every 7 requests
          if (sentCount % 7 === 0 && sentCount < CONFIG.targetCount) {
            const breakMs = rand(45000, 90000);
            console.log(`\n  ☕  Taking a ${Math.round(breakMs / 1000)}s break after ${sentCount} requests...\n`);
            await sleep(breakMs);
          }
        } else {
          const dismissBtn = await page.$('button[aria-label="Dismiss"], button:has-text("Cancel"), button[aria-label="Cancel"]');
          if (dismissBtn) await dismissBtn.click();
          console.log(`  ⏭  Skipped "${fullName}" — send button not found in modal`);
          log.skipped.push({ name: fullName, reason: 'send button not found' });
        }

      } catch (err) {
        console.error(`  ❌ Error for "${fullName}": ${err.message}`);
        log.errors.push({ name: fullName, error: err.message });
        try {
          const dismissBtn = await page.$('button[aria-label="Dismiss"], button:has-text("Cancel")');
          if (dismissBtn) await dismissBtn.click();
        } catch (_) {}
      }

      await randomDelay();
    }

    searchPage++;
  }

  // ── 4. Save log ────────────────────────────────────────────────────────────
  fs.writeFileSync(CONFIG.logFile, JSON.stringify(log, null, 2));

  console.log('\n─────────────────────────────────────');
  console.log(`✅ Done! Sent: ${log.sent.length} | Skipped: ${log.skipped.length} | Errors: ${log.errors.length}`);
  console.log(`📋 Log saved to: ${CONFIG.logFile}`);
  console.log('─────────────────────────────────────\n');

  await browser.close();
})();
