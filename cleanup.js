/**
 * Headless cleanup — cancel all test/duplicate reservations
 * No browser window, no login needed (reuses session)
 */
require('dotenv').config();
const { chromium } = require('playwright');
const path = require('path');
const RID = 1264498;
const MOD_BY = '698796db4c736d653554fa2b';
const SESSION_DIR = path.join(__dirname, '.ot-chrome-session');
const fs = require('fs');
try { for (const f of fs.readdirSync(SESSION_DIR)) { if (f.startsWith('Singleton')) try { fs.unlinkSync(path.join(SESSION_DIR, f)); } catch {} } } catch {}

(async () => {
  const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: true, viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    recordHar: { path: 'captures/cleanup.har', urlFilter: /opentable\.com/ }
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  async function ot(ep, opts = {}) {
    return page.evaluate(async ({ ep, opts }) => {
      const r = await fetch(`/gateway/proxies/${ep}`, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
      const t = await r.text();
      try { return { s: r.status, d: JSON.parse(t) }; } catch { return { s: r.status, d: t }; }
    }, { ep, opts });
  }

  async function cancelRes(resId, label) {
    const c = await ot(`foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
      method: 'PUT',
      body: { reservation: { State: 'Cancelled', Departed: null, CommandParameters: { ModifiedBy: MOD_BY }, CustomState: { CustomStateId: null }, ReservationId: resId } }
    });
    console.log(`  ${c.s === 200 ? 'CANCELLED' : 'ERROR ' + c.s} ${label}`);
  }

  // Check session
  await page.goto(`https://guestcenter.opentable.com/restaurant/${RID}/front-of-house/reservations/2026-11-02`);
  try {
    await page.waitForSelector('text=Kitchen', { timeout: 15000 });
    console.log('Session OK\n');
  } catch {
    console.log('ERROR: Session expired');
    await ctx.close();
    process.exit(1);
  }
  await page.waitForTimeout(4000);

  // Scan dates for junk
  const scanDates = ['2026-10-23', '2026-10-24', '2026-11-02'];

  for (const date of scanDates) {
    console.log(`=== ${date} ===`);
    await page.goto(`https://guestcenter.opentable.com/restaurant/${RID}/front-of-house/reservations/${date}`);
    await page.waitForTimeout(4000);

    // Find test/junk/duplicate entries
    const junkPatterns = ['Test Prueba', 'Test Capture', 'Test BotGuest', 'Guillermo Martin', 'Kayla Zacher'];
    for (const pattern of junkPatterns) {
      const entries = await page.locator(`text=${pattern}`).all();
      for (const entry of entries) {
        try {
          // Check if it's in the "Eliminado" (cancelled) section — skip those
          const parent = await entry.evaluate(el => {
            let p = el;
            for (let i = 0; i < 10; i++) { p = p.parentElement; if (!p) break; if (p.textContent?.includes('Eliminado')) return 'cancelled'; }
            return 'active';
          });
          if (parent === 'cancelled') continue;

          await entry.click();
          await page.waitForTimeout(1500);
          const url = page.url();
          const match = url.match(/reservation\/([a-f0-9-]+)/);
          if (match) {
            await cancelRes(match[1], `${pattern} on ${date}`);
          }
        } catch {}
      }
    }

    // Handle Kayla Dillard duplicates — keep only 1
    const kaylas = await page.locator('text=Kayla Dillard').all();
    // Filter out cancelled ones
    const activeKaylas = [];
    for (const k of kaylas) {
      const parent = await k.evaluate(el => {
        let p = el;
        for (let i = 0; i < 10; i++) { p = p.parentElement; if (!p) break; if (p.textContent?.includes('Eliminado')) return 'cancelled'; }
        return 'active';
      });
      if (parent === 'active') activeKaylas.push(k);
    }

    if (activeKaylas.length > 1) {
      console.log(`  ${activeKaylas.length} active Kayla Dillard — keeping last, cancelling ${activeKaylas.length - 1}`);
      for (let i = 0; i < activeKaylas.length - 1; i++) {
        try {
          await activeKaylas[i].click();
          await page.waitForTimeout(1500);
          const url = page.url();
          const match = url.match(/reservation\/([a-f0-9-]+)/);
          if (match) await cancelRes(match[1], 'Kayla Dillard DUP');
        } catch {}
      }
    } else if (activeKaylas.length === 1) {
      console.log(`  1 Kayla Dillard — OK`);
    }

    // Handle Guillermo Von Papendieck test reservations (not the real staff entries)
    const guilleEntries = await page.locator('text=Guillermo Von Papendieck').all();
    for (const g of guilleEntries) {
      const parent = await g.evaluate(el => {
        let p = el;
        for (let i = 0; i < 10; i++) { p = p.parentElement; if (!p) break; if (p.textContent?.includes('Eliminado')) return 'cancelled'; }
        return 'active';
      });
      if (parent === 'cancelled') continue;
      // Only cancel if it's a reservation entry (has time), not a staff label
      const text = await g.evaluate(el => el.closest('[class*="reservation"]')?.textContent || '');
      if (text.includes('20:00') || text.includes('20:15') || text.includes('20:30') || text.includes('21:00')) {
        try {
          await g.click();
          await page.waitForTimeout(1500);
          const url = page.url();
          const match = url.match(/reservation\/([a-f0-9-]+)/);
          if (match) await cancelRes(match[1], 'Guillermo test');
        } catch {}
      }
    }
  }

  // Screenshot final state
  await page.goto(`https://guestcenter.opentable.com/restaurant/${RID}/front-of-house/reservations/2026-11-02`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'captures/nov2-clean.png' });
  console.log('\n📸 captures/nov2-clean.png');

  await ctx.close();
  console.log('HAR saved. DONE.');
})();
