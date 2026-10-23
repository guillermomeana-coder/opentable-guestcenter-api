/**
 * OT GuestCenter — Full UI Capture
 * Navega CADA seccion del GuestCenter interceptando TODOS los network requests.
 * Guarda endpoints unicos en captures/full-capture.json
 */

require('dotenv').config();
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');

const RID = 1264498;
const SESSION_DIR = path.join(__dirname, '.ot-browser-data');
const CAPTURES_DIR = path.join(__dirname, 'captures');
const BASE = `https://guestcenter.opentable.com`;
const GATEWAY = '/gateway/proxies/';

if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

// All known GC sections to navigate
const SECTIONS = [
  { name: 'Home', path: `/restaurant/${RID}/home` },
  { name: 'Reservations Today', path: `/restaurant/${RID}/front-of-house/reservations/${todayStr()}` },
  { name: 'Reservations Nov2', path: `/restaurant/${RID}/front-of-house/reservations/2026-11-02` },
  { name: 'Guestbook', path: `/restaurant/${RID}/front-of-house/gm/guestbook` },
  { name: 'Waitlist', path: `/restaurant/${RID}/front-of-house/waitlist` },
  { name: 'Floorplan', path: `/restaurant/${RID}/front-of-house/floor-plan` },
  { name: 'Cover Trends', path: `/restaurant/${RID}/reporting/cover-trends` },
  { name: 'Marketing Insights', path: `/restaurant/${RID}/marketing/insights` },
  { name: 'Marketing Campaigns', path: `/restaurant/${RID}/marketing/campaigns` },
  { name: 'Marketing Experiences', path: `/restaurant/${RID}/marketing/experiences` },
  { name: 'Reviews', path: `/restaurant/${RID}/feedback/reviews` },
  { name: 'Profile Basic', path: `/restaurant/${RID}/profile/basic-information` },
  { name: 'Profile Photos', path: `/restaurant/${RID}/profile/photos` },
  { name: 'Profile Menu', path: `/restaurant/${RID}/profile/menu` },
  { name: 'Profile Descriptions', path: `/restaurant/${RID}/profile/descriptions` },
  { name: 'Inventory Shifts', path: `/restaurant/${RID}/inventory#/shift` },
  { name: 'Inventory Access Rules', path: `/restaurant/${RID}/inventory#/access-rules` },
  { name: 'Inventory Tables', path: `/restaurant/${RID}/inventory#/tables-and-combinations` },
  { name: 'Inventory Dining Areas', path: `/restaurant/${RID}/inventory#/dining-areas` },
  { name: 'Accounts Users', path: `/restaurant/${RID}/accounts/user-directory` },
  { name: 'Settings General', path: `/restaurant/${RID}/restaurant-settings/general` },
  { name: 'Settings QR Codes', path: `/restaurant/${RID}/restaurant-settings/qrcodes` },
  { name: 'Settings Payments', path: `/restaurant/${RID}/restaurant-settings/payments` },
  { name: 'Settings Guest Comms', path: `/restaurant/${RID}/restaurant-settings/guest-communications` },
  { name: 'Settings Policies', path: `/restaurant/${RID}/restaurant-settings/policies` },
  { name: 'Integrations', path: `/restaurant/${RID}/integrations/all-integrations/all` },
  { name: 'Private Dining', path: `/restaurant/${RID}/private-dining/inquiries` },
  { name: 'Private Dining Products', path: `/restaurant/${RID}/private-dining/products` },
  { name: 'Referrals', path: `/restaurant/${RID}/front-of-house/gm/referrals` },
  { name: 'Guest Tags', path: `/restaurant/${RID}/front-of-house/gm/guest-tags` },
  { name: 'Server Performance', path: `/restaurant/${RID}/reporting/server-performance` },
  { name: 'Shift Summary', path: `/restaurant/${RID}/reporting/shift-summary` },
  { name: 'Cancellations', path: `/restaurant/${RID}/reporting/cancellation-report` },
  { name: 'No Shows', path: `/restaurant/${RID}/reporting/no-shows` },
  { name: 'Reservation Summary', path: `/restaurant/${RID}/reporting/reservation-detail` },
  { name: 'Inbox', path: `/restaurant/${RID}/inbox` },
];

const captured = {};  // url -> { method, section, body?, status?, responseSnippet? }
let totalRequests = 0;

function todayStr() {
  const d = new Date();
  return d.toISOString().substring(0, 10);
}

function cleanUrl(url) {
  // Remove query params for dedup key but keep the full URL too
  try {
    const u = new URL(url);
    return u.pathname;
  } catch { return url; }
}

(async () => {
  // Clean lockfile
  const lockfile = path.join(SESSION_DIR, 'lockfile');
  if (fs.existsSync(lockfile)) try { fs.unlinkSync(lockfile); } catch {}

  console.log('[CAPTURE] Abriendo browser...');
  const ctx = await firefox.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 }
  });

  const page = ctx.pages()[0] || await ctx.newPage();

  // Intercept ALL requests
  page.on('request', req => {
    const url = req.url();
    if (!url.includes('guestcenter.opentable.com') && !url.includes('restauth.opentable.com')) return;
    if (url.includes('/log') || url.includes('analytics') || url.includes('tracking') || url.includes('.js') || url.includes('.css') || url.includes('.png') || url.includes('.svg') || url.includes('.woff')) return;

    totalRequests++;
    const method = req.method();
    const cleanPath = cleanUrl(url);
    const key = `${method} ${cleanPath}`;

    if (!captured[key]) {
      let body = null;
      try { body = req.postData(); } catch {}
      captured[key] = {
        method,
        url: url.replace(BASE, ''),
        cleanPath,
        section: 'pending',
        body: body ? tryParse(body) : null,
        timestamp: new Date().toISOString()
      };
    }
  });

  // Also capture responses for status codes
  page.on('response', async resp => {
    const url = resp.url();
    if (!url.includes('guestcenter.opentable.com') && !url.includes('restauth.opentable.com')) return;
    const method = resp.request().method();
    const cleanPath = cleanUrl(url);
    const key = `${method} ${cleanPath}`;

    if (captured[key] && !captured[key].status) {
      captured[key].status = resp.status();
      // Try to capture response snippet for new endpoints
      try {
        const ct = resp.headers()['content-type'] || '';
        if (ct.includes('json')) {
          const text = await resp.text().catch(() => '');
          if (text.length < 5000) {
            captured[key].responseSnippet = tryParse(text);
          } else {
            // Just capture keys for large responses
            const parsed = JSON.parse(text);
            captured[key].responseKeys = Object.keys(parsed);
            captured[key].responseSize = text.length;
          }
        }
      } catch {}
    }
  });

  // Navigate to GC home first, check login
  console.log('[CAPTURE] Navegando al Home...');
  await page.goto(`${BASE}/restaurant/${RID}/home`);

  try {
    await page.waitForSelector('text=Kitchen', { timeout: 15000 });
    console.log('[CAPTURE] Sesion activa!');
  } catch {
    console.log('[CAPTURE] ⚠️ Sesion expirada — logueate en la ventana del browser');
    await page.waitForSelector('text=Kitchen', { timeout: 600000 });
    console.log('[CAPTURE] Login OK!');
  }

  // Wait for home to fully load
  await page.waitForTimeout(3000);
  markSection('Home');

  // Navigate each section
  for (const section of SECTIONS) {
    if (section.name === 'Home') continue; // already loaded

    console.log(`\n[CAPTURE] === ${section.name} === (${section.path})`);

    try {
      await page.goto(`${BASE}${section.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000); // Let API calls fire

      // Extra waits for specific sections
      if (section.name.includes('Reviews')) {
        // Click through review tabs if they exist
        try {
          const tabs = await page.$$('[role="tab"]');
          for (const tab of tabs) {
            await tab.click().catch(() => {});
            await page.waitForTimeout(1500);
          }
        } catch {}
      }

      if (section.name.includes('Reservations')) {
        // Try clicking on a reservation to get detail endpoints
        try {
          const resCard = await page.$('[data-testid*="reservation"]');
          if (resCard) {
            await resCard.click();
            await page.waitForTimeout(2000);
            // Close the panel
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
          }
        } catch {}
      }

      if (section.name.includes('Guestbook')) {
        // Click on first guest
        try {
          const guestRow = await page.$('tr[class*="guest"], [data-testid*="guest"]');
          if (guestRow) {
            await guestRow.click();
            await page.waitForTimeout(2000);
            await page.keyboard.press('Escape');
          }
        } catch {}
      }

      if (section.name === 'Floorplan') {
        // Click on a table
        try {
          const table = await page.$('[data-testid*="table"], [class*="table-marker"]');
          if (table) {
            await table.click();
            await page.waitForTimeout(1500);
          }
        } catch {}
      }

      if (section.name.includes('Inventory')) {
        // Click through tabs
        try {
          const tabs = await page.$$('[role="tab"]');
          for (const tab of tabs) {
            await tab.click().catch(() => {});
            await page.waitForTimeout(2000);
          }
        } catch {}
      }

      markSection(section.name);
      console.log(`  ✅ ${Object.keys(captured).length} endpoints total (${totalRequests} requests)`);

    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
      markSection(section.name + ' (ERROR)');
    }
  }

  // === PHASE 2: Interaction captures ===
  console.log('\n\n[CAPTURE] === PHASE 2: Interaction captures ===\n');

  // Navigate to reservations page with data
  await page.goto(`${BASE}/restaurant/${RID}/front-of-house/reservations/2026-11-02`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Try to click a reservation and interact with it
  try {
    console.log('[CAPTURE] Buscando reserva para interactuar...');
    // Look for any reservation card/row
    const resElements = await page.$$('[data-testid*="shift-container"] [data-testid*="reservation"], [class*="reservation"]');
    console.log(`  Encontre ${resElements.length} elementos de reserva`);

    if (resElements.length > 0) {
      await resElements[0].click();
      await page.waitForTimeout(2000);
      markSection('Reservation Detail Panel');

      // Try clicking "Assign Server" / staff dropdown
      try {
        const staffBtn = await page.$('[data-testid*="staff"], [data-testid*="server"], [aria-label*="server"], [aria-label*="staff"]');
        if (staffBtn) {
          await staffBtn.click();
          await page.waitForTimeout(1500);
          markSection('Staff Assignment');
          await page.keyboard.press('Escape');
        }
      } catch {}

      // Try clicking status dropdown
      try {
        const statusBtn = await page.$('[data-testid*="status"], [data-testid*="state"]');
        if (statusBtn) {
          await statusBtn.click();
          await page.waitForTimeout(1500);
          markSection('Status Change');
          await page.keyboard.press('Escape');
        }
      } catch {}

      // Try looking for "arrived" / "seated" buttons
      try {
        const actionBtns = await page.$$('button');
        for (const btn of actionBtns) {
          const text = await btn.textContent().catch(() => '');
          if (/arrive|seat|complet|no.?show/i.test(text)) {
            console.log(`  Found action button: "${text}"`);
            // Don't click it — just log it exists
          }
        }
      } catch {}

      await page.keyboard.press('Escape');
    }
  } catch (e) {
    console.log(`  Reservation interaction error: ${e.message}`);
  }

  // Navigate to Reviews and try respond flow
  console.log('\n[CAPTURE] Reviews respond flow...');
  await page.goto(`${BASE}/restaurant/${RID}/feedback/reviews`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  try {
    // Click on first review
    const reviewCard = await page.$('[data-testid*="review"], [class*="review-card"], [class*="ReviewCard"]');
    if (reviewCard) {
      await reviewCard.click();
      await page.waitForTimeout(2000);
      markSection('Review Detail');

      // Look for respond button
      const respondBtn = await page.$('button:has-text("respond"), button:has-text("Reply"), button:has-text("Respond"), [data-testid*="respond"]');
      if (respondBtn) {
        console.log('  Found respond button!');
        await respondBtn.click();
        await page.waitForTimeout(2000);
        markSection('Review Respond');
        await page.keyboard.press('Escape');
      }
    }
  } catch (e) {
    console.log(`  Reviews interaction error: ${e.message}`);
  }

  // Final save
  const output = {
    capturedAt: new Date().toISOString(),
    rid: RID,
    totalUniqueEndpoints: Object.keys(captured).length,
    totalRequests,
    sections: [...new Set(Object.values(captured).map(c => c.section))],
    endpoints: Object.entries(captured)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({ key, ...val }))
  };

  const outPath = path.join(CAPTURES_DIR, 'full-capture.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n\n[CAPTURE] === DONE ===`);
  console.log(`  Unique endpoints: ${output.totalUniqueEndpoints}`);
  console.log(`  Total requests: ${totalRequests}`);
  console.log(`  Sections visited: ${output.sections.length}`);
  console.log(`  Saved to: ${outPath}`);

  // Also save a summary grouped by section
  const bySection = {};
  for (const [key, val] of Object.entries(captured)) {
    if (!bySection[val.section]) bySection[val.section] = [];
    bySection[val.section].push({ key, method: val.method, url: val.url, status: val.status });
  }
  fs.writeFileSync(
    path.join(CAPTURES_DIR, 'by-section.json'),
    JSON.stringify(bySection, null, 2)
  );

  // Save as markdown for easy reading
  let md = `# OT GuestCenter — Full API Capture\n\nCaptured: ${new Date().toISOString()}\nRID: ${RID}\nUnique endpoints: ${output.totalUniqueEndpoints}\nTotal requests: ${totalRequests}\n\n`;

  for (const [section, endpoints] of Object.entries(bySection)) {
    md += `## ${section}\n\n`;
    md += `| Method | Endpoint | Status |\n|--------|----------|--------|\n`;
    for (const ep of endpoints) {
      md += `| ${ep.method} | \`${ep.url.substring(0, 120)}\` | ${ep.status || '?'} |\n`;
    }
    md += '\n';
  }

  fs.writeFileSync(path.join(CAPTURES_DIR, 'full-capture.md'), md);
  console.log('  Markdown summary saved too.');

  // Keep browser open for manual inspection
  console.log('\n  Browser queda abierto. Ctrl+C para cerrar.');
})();

function markSection(name) {
  for (const val of Object.values(captured)) {
    if (val.section === 'pending') val.section = name;
  }
}

function tryParse(text) {
  try { return JSON.parse(text); } catch { return text; }
}
