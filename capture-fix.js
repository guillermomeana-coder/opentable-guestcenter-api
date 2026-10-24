/**
 * Fix capture — test staff assignment, tables, reviews respond, arrived/seated
 * Reuses the browser from capture-actions.js that's still open
 */
require('dotenv').config();
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');

const RID = 1264498;
const MOD_BY = '698796db4c736d653554fa2b';
const SESSION_DIR = path.join(__dirname, '.ot-browser-data');

const results = [];
function log(action, result) {
  const icon = result.s >= 200 && result.s < 300 ? '✅' : '❌';
  console.log(`${icon} [${action}] ${result.s}`);
  if (result.s >= 200 && result.s < 300) {
    console.log(JSON.stringify(result.d, null, 2).substring(0, 400));
  } else {
    console.log('Error:', JSON.stringify(result.d).substring(0, 300));
  }
  results.push({ action, status: result.s, response: result.d });
}

async function ot(page, endpoint, options = {}) {
  return page.evaluate(async ({ endpoint, options }) => {
    const r = await fetch(`/gateway/proxies/${endpoint}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const t = await r.text();
    try { return { s: r.status, d: JSON.parse(t) }; }
    catch { return { s: r.status, d: t }; }
  }, { endpoint, options });
}

(async () => {
  const lockfile = path.join(SESSION_DIR, 'lockfile');
  if (fs.existsSync(lockfile)) try { fs.unlinkSync(lockfile); } catch {}

  const ctx = await firefox.launchPersistentContext(SESSION_DIR, {
    headless: false, viewport: { width: 1440, height: 900 }
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`https://guestcenter.opentable.com/restaurant/${RID}/front-of-house/reservations/2026-11-02`);

  try {
    await page.waitForSelector('text=Kitchen', { timeout: 15000 });
    console.log('Sesion activa!\n');
  } catch {
    console.log('⚠️ Logueate...');
    await page.waitForSelector('text=Kitchen', { timeout: 600000 });
  }
  await page.waitForTimeout(3000);

  // ========= 1. CREATE TEST RESERVATION =========
  console.log('=== CREATE TEST ===');
  const gSearch = await ot(page, `gcFohWeb/api/${RID}/v4/guests/search?query=Guillermo`);
  const guest = gSearch.d?.results?.[0];
  const testId = await page.evaluate(() => crypto.randomUUID());

  const created = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations?disableVault=true`, {
    method: 'POST',
    body: {
      RID, State: 'NotConfirmed', Origin: 'PHONE', ReservationId: testId,
      PartySize: 2, Scheduled: '2026-11-03T03:00:00Z', ScheduledLocal: '2026-11-02T20:00:00',
      $restaurantDay: '2026-11-02', GuestId: guest.guest_id,
      DiningAreaId: 0, ExperienceId: 0, DiningArea: { Selection: 'any', Id: 0 },
      SlotLockId: null, SMSOptIn: false, EmailConfirmationOptOut: false,
      OverbookingReason: 'None',
      CancellationPolicyId: '64b846257896686eaddea365:v12',
      CancellationPolicyWaivedReason: 'InHouse',
      DepositDetails: { TotalPrice: 60000, Currency: 'MXN', CurrencyDenominator: 100, Status: 'Waived' },
      BookingContext: { NoTablesAvailable: false, NoPrivateDiningAvailable: false, OnlyNonreservableTablesAvailable: false, EachAvailableTableViolatesATurnControl: false, PartySizeViolatesExperienceConstraints: false, NoTablesAvailableForExperience: false, TimeViolatesExperienceConstraints: false, AllowedBookingChannelViolations: [], AllowAccessRuleViolation: false },
      CommandParameters: { ModifiedBy: MOD_BY, ClientInfo: { Client: 'Web App', ClientVersion: 'gc-microapp-front-of-house-Base-10144' } },
      Tags: [], $allTags: []
    }
  });
  log('CREATE', created);
  const resId = created.d?.ReservationId || testId;
  console.log(`#${created.d?.ConfirmationNumber} ID: ${resId}\n`);

  // ========= 2. ASSIGN STAFF — try StaffId with UUID from Staff endpoint =========
  console.log('=== STAFF ASSIGNMENT ===');
  // Active staff: Steff=2CADB5F3-B946-430F-8761-EB6A4ADED9AA, Baruch=CE60D2A0-B441-4123-8CED-2ED9E922D2FA
  const steffId = '2CADB5F3-B946-430F-8761-EB6A4ADED9AA';

  // Attempt 1: StaffId only
  const s1 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { StaffId: steffId, ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
  });
  log('STAFF_StaffId', s1);

  // Attempt 2: Server name string only
  const s2 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { Server: 'Steff', ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
  });
  log('STAFF_ServerName', s2);

  // Attempt 3: Both StaffId + Server
  const s3 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { StaffId: steffId, Server: 'Steff', ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
  });
  log('STAFF_Both', s3);

  // Check current state of the reservation
  const check1 = await ot(page, `gcFohWeb/api/${RID}/bulk-sync?entities=Reservations`, {
    method: 'POST',
    body: { Reservations: { restaurantDay: '2026-11-02', sinceSequenceId: 0, useNewReservationSyncApi: true } }
  });
  const ourRes = check1.d?.Reservations?.Results?.find(r => r.ReservationId === resId);
  if (ourRes) {
    console.log(`\nReservation state: StaffId=${ourRes.StaffId}, Server=${ourRes.Server}, Tables=${JSON.stringify(ourRes.Tables)}`);
  }

  // ========= 3. GET FLOORPLAN for table IDs =========
  console.log('\n=== FLOORPLAN / TABLES ===');
  const fp = await ot(page, ``, { method: 'GET' }); // dummy — use setup endpoint
  // Use the setup floorplan endpoint (not under gateway/proxies)
  const fpData = await page.evaluate(async (rid) => {
    const r = await fetch(`/setup/api/restaurant/${rid}/floorplan`);
    return { s: r.status, d: await r.json().catch(() => r.text()) };
  }, RID);
  log('FLOORPLAN', fpData);

  // Extract table IDs from floorplan
  if (fpData.s === 200 && fpData.d) {
    const tables = fpData.d.tables || fpData.d.Tables || [];
    const sections = fpData.d.sections || fpData.d.Sections || [];
    console.log(`Tables: ${tables.length}, Sections: ${sections.length}`);
    if (tables.length) console.log('First table:', JSON.stringify(tables[0]).substring(0, 300));
    if (sections.length) console.log('First section:', JSON.stringify(sections[0]).substring(0, 300));

    // Try to find table keys from any structure
    const keys = Object.keys(fpData.d);
    console.log('Floorplan keys:', keys);
    for (const k of keys) {
      if (Array.isArray(fpData.d[k]) && fpData.d[k].length > 0) {
        console.log(`${k}[0]:`, JSON.stringify(fpData.d[k][0]).substring(0, 200));
      }
    }
  }

  // ========= 4. TRY ASSIGN TABLE with table ID from reservation =========
  console.log('\n=== TABLE ASSIGNMENT ===');
  // The created reservation got Tables: ["ze"]. Try assigning a specific table.
  // Try with the table string format
  const t1 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { Tables: ['tb'], ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
  });
  log('TABLE_StringArray', t1);

  // Try with IsHardAssignmentLock
  const t2 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { Tables: ['tb'], IsHardAssignmentLock: true, TablesFixed: true, ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
  });
  log('TABLE_WithLock', t2);

  // ========= 5. REVIEWS — fix body format =========
  console.log('\n=== REVIEWS ===');
  // Try with empty body
  const rv1 = await ot(page, `hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/${RID}/reviews/details`, {
    method: 'POST', body: {}
  });
  log('REVIEWS_EmptyBody', rv1);

  // Try with full filter
  const rv2 = await ot(page, `hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/${RID}/reviews/details`, {
    method: 'POST', body: { pageNumber: 0, limit: 5, sortBy: 'newest', sources: [], ratingRange: { min: 1, max: 5 } }
  });
  log('REVIEWS_FullFilter', rv2);

  // Try getting filter options first
  const rvOpts = await ot(page, `hospitality/ot4rFeedbackBff/api/v1/feedback-reviews/restaurant/${RID}/options`, {
    method: 'POST', body: {}
  });
  log('REVIEW_OPTIONS', rvOpts);

  // ========= 6. CLEANUP — Cancel test reservation =========
  console.log('\n=== CLEANUP ===');
  const cancel = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { State: 'Cancelled', Departed: null, CommandParameters: { ModifiedBy: MOD_BY }, CustomState: { CustomStateId: null }, ReservationId: resId } }
  });
  log('CANCEL', cancel);

  // Save
  fs.writeFileSync(path.join(__dirname, 'captures', 'fix-captures.json'), JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} results`);

  console.log('\n=== SUMMARY ===');
  results.forEach(r => {
    const icon = r.status >= 200 && r.status < 300 ? '✅' : '❌';
    console.log(`${icon} ${r.action}: ${r.status}`);
  });

  console.log('\nCerrando browser...');
  await ctx.close();
})();
