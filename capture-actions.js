/**
 * OT GuestCenter — Capture Missing Action Endpoints
 *
 * Uses existing browser session to test:
 * 1. Assign staff/server to reservation
 * 2. Mark arrived/seated/completed/no-show
 * 3. Respond to a review
 * 4. Assign specific table
 * 5. Create new guest
 * 6. Venue details (tables layout)
 * 7. Guest tags management
 * 8. Waitlist operations
 * 9. Messaging operations
 */

require('dotenv').config();
const { firefox } = require('playwright');
const path = require('path');
const fs = require('fs');

const RID = 1264498;
const MOD_BY = '698796db4c736d653554fa2b';
const SESSION_DIR = path.join(__dirname, '.ot-browser-data');
const CAPTURES_DIR = path.join(__dirname, 'captures');

if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });

const results = [];

function log(action, result) {
  console.log(`\n[${action}] Status: ${result.s}`);
  if (result.s >= 200 && result.s < 300) {
    const str = JSON.stringify(result.d, null, 2);
    console.log(str.substring(0, 500));
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

  console.log('[ACTIONS] Abriendo browser...');
  const ctx = await firefox.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 }
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`https://guestcenter.opentable.com/restaurant/${RID}/front-of-house/reservations/2026-11-02`);

  try {
    await page.waitForSelector('text=Kitchen', { timeout: 15000 });
    console.log('[ACTIONS] Sesion activa!');
  } catch {
    console.log('[ACTIONS] ⚠️ Logueate en OT GuestCenter...');
    await page.waitForSelector('text=Kitchen', { timeout: 600000 });
  }

  await page.waitForTimeout(3000);

  // ========================================
  // 1. GET VENUE DETAILS (tables, sections, floor plan)
  // ========================================
  console.log('\n\n=== 1. VENUE DETAILS ===');

  const venue = await ot(page, `gcVenue/umami_venue/api/v4/Restaurant/${RID}`);
  log('VENUE_DETAILS', venue);

  // ========================================
  // 2. GET STAFF LIST
  // ========================================
  console.log('\n\n=== 2. STAFF LIST ===');

  const staff = await ot(page, `gcVenue/umami_venue/api/v4/Restaurant/${RID}/Staff?sinceSequenceId=0&count=1000&includeDeleted=false`);
  log('STAFF_LIST', staff);

  // ========================================
  // 3. GET RESTAURANT PARTICIPANTS (for reservation assignment)
  // ========================================
  console.log('\n\n=== 3. RESTAURANT PARTICIPANTS ===');

  const participants = await ot(page, `gcFohWeb/api/${RID}/restaurantParticipants`);
  log('RESTAURANT_PARTICIPANTS', participants);

  // ========================================
  // 4. CREATE TEST RESERVATION
  // ========================================
  console.log('\n\n=== 4. CREATE TEST RESERVATION ===');

  const testResId = await page.evaluate(() => crypto.randomUUID());
  // Search for Guillermo first
  const gSearch = await ot(page, `gcFohWeb/api/${RID}/v4/guests/search?query=Guillermo`);
  const guilleGuest = gSearch.d?.results?.[0];
  console.log('Guest:', guilleGuest?.first_name, guilleGuest?.last_name, guilleGuest?.guest_id);

  if (!guilleGuest) {
    console.log('ERROR: No guest found. Skipping reservation tests.');
    process.exit(1);
  }

  const createRes = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations?disableVault=true`, {
    method: 'POST',
    body: {
      RID, State: 'NotConfirmed', Origin: 'PHONE', ReservationId: testResId,
      PartySize: 2, Scheduled: '2026-11-03T03:00:00Z', ScheduledLocal: '2026-11-02T20:00:00',
      $restaurantDay: '2026-11-02', GuestId: guilleGuest.guest_id,
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
  log('CREATE_RESERVATION', createRes);

  const confNum = createRes.d?.ConfirmationNumber;
  const resId = createRes.d?.ReservationId || testResId;
  console.log(`Confirmation #${confNum}, ID: ${resId}`);

  // ========================================
  // 5. ASSIGN STAFF/SERVER via PUT
  // ========================================
  console.log('\n\n=== 5. ASSIGN STAFF ===');

  // Try different formats for staff assignment
  // First get staff IDs from participants
  const staffList = participants.d || [];
  console.log('Available staff:', staffList.length, 'participants');
  if (staffList.length) {
    console.log('First staff:', JSON.stringify(staffList[0]).substring(0, 200));
  }

  // Try with StaffId field
  if (staffList.length > 0) {
    const firstStaff = staffList[0];

    // Attempt 1: StaffId
    const staffRes1 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
      method: 'PUT',
      body: { reservation: { StaffId: firstStaff.ParticipantId || firstStaff.Id || firstStaff.id, ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
    });
    log('ASSIGN_STAFF_StaffId', staffRes1);

    // Attempt 2: Server field (name string)
    if (staffRes1.s !== 200) {
      const staffRes2 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
        method: 'PUT',
        body: { reservation: { Server: firstStaff.Name || firstStaff.name || 'Guillermo von Papendieck', ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
      });
      log('ASSIGN_STAFF_Server', staffRes2);
    }

    // Attempt 3: Both StaffId + Server
    if (staffRes1.s !== 200) {
      const staffRes3 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
        method: 'PUT',
        body: { reservation: { StaffId: firstStaff.ParticipantId || firstStaff.Id, Server: firstStaff.Name || firstStaff.name, ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
      });
      log('ASSIGN_STAFF_Both', staffRes3);
    }
  }

  // ========================================
  // 6. ASSIGN TABLE via PUT
  // ========================================
  console.log('\n\n=== 6. ASSIGN TABLE ===');

  // Get venue tables first
  const tables = venue.d?.Tables || [];
  console.log(`${tables.length} tables in venue`);
  if (tables.length) {
    console.log('First table:', JSON.stringify(tables[0]).substring(0, 200));
  }

  if (tables.length > 0) {
    const firstTable = tables[0];

    // Attempt 1: Tables array with TableId
    const tableRes1 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
      method: 'PUT',
      body: { reservation: { Tables: [{ TableId: firstTable.TableId || firstTable.Id }], ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
    });
    log('ASSIGN_TABLE_Array', tableRes1);

    // Attempt 2: Tables with full object
    if (tableRes1.s !== 200) {
      const tableRes2 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
        method: 'PUT',
        body: { reservation: { Tables: [{ TableId: firstTable.TableId || firstTable.Id, IsHardAssignment: true }], IsHardAssignmentLock: true, ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
      });
      log('ASSIGN_TABLE_Full', tableRes2);
    }

    // Attempt 3: Just the table as string array
    if (tableRes1.s !== 200) {
      const tableRes3 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
        method: 'PUT',
        body: { reservation: { Tables: [firstTable.TableId || firstTable.Id], ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
      });
      log('ASSIGN_TABLE_StringArray', tableRes3);
    }
  }

  // ========================================
  // 7. MARK ARRIVED (timestamp)
  // ========================================
  console.log('\n\n=== 7. MARK ARRIVED ===');

  const now = new Date().toISOString();

  // Attempt: Set Arrived timestamp
  const arrivedRes = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { Arrived: now, State: 'Confirmed', ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
  });
  log('MARK_ARRIVED', arrivedRes);

  // ========================================
  // 8. MARK SEATED
  // ========================================
  console.log('\n\n=== 8. MARK SEATED ===');

  const seatedRes = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { Seated: now, ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
  });
  log('MARK_SEATED', seatedRes);

  // ========================================
  // 9. MARK COMPLETED
  // ========================================
  console.log('\n\n=== 9. MARK COMPLETED ===');

  const completedRes = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { Completed: now, Departed: now, ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
  });
  log('MARK_COMPLETED', completedRes);

  // ========================================
  // 10. MARK NO-SHOW (on a different state — need new reservation)
  // ========================================
  console.log('\n\n=== 10. MARK NO-SHOW ===');

  const noShowRes = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { NoShow: now, ReservationId: resId, CommandParameters: { ModifiedBy: MOD_BY } } }
  });
  log('MARK_NOSHOW', noShowRes);

  // ========================================
  // 11. CANCEL TEST RESERVATION (cleanup)
  // ========================================
  console.log('\n\n=== 11. CANCEL TEST ===');

  const cancelRes = await ot(page, `foh-web/gcFohWeb/api/${RID}/v2/reservations/${resId}`, {
    method: 'PUT',
    body: { reservation: { State: 'Cancelled', Departed: null, CommandParameters: { ModifiedBy: MOD_BY }, CustomState: { CustomStateId: null }, ReservationId: resId } }
  });
  log('CANCEL_TEST', cancelRes);

  // ========================================
  // 12. REVIEWS — GET DETAILS FOR RESPOND
  // ========================================
  console.log('\n\n=== 12. REVIEWS DETAILS ===');

  const reviewDetails = await ot(page, `hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/${RID}/reviews/details`, {
    method: 'POST',
    body: { pageNumber: 0, limit: 5, sortBy: 'newest' }
  });
  log('REVIEW_DETAILS', reviewDetails);

  // Check if any review is respondable
  const reviews = reviewDetails.d?.data || [];
  const respondable = reviews.find(r => r.respondable);
  if (respondable) {
    console.log(`\nFound respondable review: ${respondable.id} by ${respondable.guestName} (${respondable.source})`);
    console.log(`  respondable: ${respondable.respondable}, rtRespondable: ${respondable.rtRespondable}`);
    console.log(`  businessResponseUrl: ${respondable.businessResponseUrl}`);

    // Try to find the respond API endpoint
    // OT reviews: try PUT to update with response
    console.log('\n=== 12b. TRY RESPOND TO OT REVIEW ===');

    const otReview = reviews.find(r => r.source === 'OpenTable' && r.respondable);
    if (otReview) {
      // Attempt: POST response
      const respondRes = await ot(page, `hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/${RID}/reviews/${otReview.id}/response`, {
        method: 'POST',
        body: { response: 'Thank you for your wonderful review! We look forward to welcoming you back.' }
      });
      log('RESPOND_REVIEW_POST', respondRes);

      // Attempt 2: PUT response
      if (respondRes.s >= 400) {
        const respondRes2 = await ot(page, `hospitality/ot4rFeedbackBff/api/v1/feedback-reviews/restaurant/${RID}/reviews/${otReview.id}/response`, {
          method: 'POST',
          body: { response: 'Thank you for your wonderful review! We look forward to welcoming you back.' }
        });
        log('RESPOND_REVIEW_BFF', respondRes2);
      }

      // Attempt 3: via private notes
      if (respondRes.s >= 400) {
        const notesRes = await ot(page, `hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/${RID}/reviews/${otReview.id}/private-notes`, {
          method: 'PUT',
          body: { privateNotes: 'Test private note' }
        });
        log('REVIEW_PRIVATE_NOTES', notesRes);
      }
    }
  }

  // ========================================
  // 13. CREATE NEW GUEST
  // ========================================
  console.log('\n\n=== 13. CREATE NEW GUEST ===');

  // Try POST to guest endpoint
  const newGuestRes = await ot(page, `gcFohWeb/api/${RID}/v4/guests`, {
    method: 'POST',
    body: {
      first_name: 'Test',
      last_name: 'BotGuest',
      phone_numbers: [{ country_code: '52', number: '6241234567', type: 'mobile' }],
      email: 'test@example.com'
    }
  });
  log('CREATE_GUEST', newGuestRes);

  // Try alternate endpoint
  if (newGuestRes.s >= 400) {
    const newGuestRes2 = await ot(page, `foh-web/gcFohWeb/api/${RID}/v1/guests`, {
      method: 'POST',
      body: {
        first_name: 'Test',
        last_name: 'BotGuest',
        phone_numbers: [{ country_code: '52', number: '6241234567', type: 'mobile' }],
        email: 'test@example.com'
      }
    });
    log('CREATE_GUEST_V1', newGuestRes2);
  }

  // ========================================
  // 14. GUEST TAGS
  // ========================================
  console.log('\n\n=== 14. GUEST TAGS CONFIG ===');

  const tagsConfig = await ot(page, `guest-management/autotagsConfigBff/api/v2/restaurant/${RID}/tags`);
  log('GUEST_TAGS_CONFIG', tagsConfig);

  // ========================================
  // 15. WAITLIST PARTIES
  // ========================================
  console.log('\n\n=== 15. WAITLIST ===');

  const waitlist = await ot(page, `gcFohWeb/api/${RID}/bulk-sync?entities=ReservationWaitlistParties,Notes`, {
    method: 'POST',
    body: {
      ReservationWaitlistParties: { restaurantDay: '2026-11-02', sinceSequenceId: 0, count: 500 },
      Notes: { startDate: '2026-11-02T05:00:00', endDate: '2026-11-03T04:59:00', sinceSequenceId: 0, count: 500 }
    }
  });
  log('WAITLIST_SYNC', waitlist);

  // ========================================
  // 16. FLOOR PLAN DATA
  // ========================================
  console.log('\n\n=== 16. FLOOR PLAN ===');

  const floorplan = await ot(page, `gcVenue/umami_venue/api/v4/Restaurant/${RID}/Policies`);
  log('VENUE_POLICIES', floorplan);

  // ========================================
  // 17. MESSAGING — READ A CONVERSATION
  // ========================================
  console.log('\n\n=== 17. MESSAGING ===');

  // Get conversation by confirmation number
  const msgConv = await ot(page, `gc-inbox/gcDmService/v2/restaurants/${RID}/conversation/confirmation/14495`);
  log('CONVERSATION_BY_CONF', msgConv);

  // ========================================
  // 18. DETAILED AVAILABILITY
  // ========================================
  console.log('\n\n=== 18. AVAILABILITY ===');

  const avail = await ot(page, `fohAggregator/v4/${RID}/detailedAvailability`, {
    method: 'POST',
    body: { date: '2026-11-02', partySize: 2, accessRuleIds: [], bookingChannel: 'InHouse' }
  });
  log('AVAILABILITY', avail);

  // ========================================
  // 19. REFERRERS FULL LIST
  // ========================================
  console.log('\n\n=== 19. REFERRERS ===');

  const referrers = await ot(page, `referralManagement/user/v1/restaurants/${RID}/referrers`);
  log('REFERRERS_COUNT', { s: referrers.s, d: { count: (referrers.d || []).length, sample: (referrers.d || []).slice(0, 2) } });

  // ========================================
  // 20. CONFIGURATION
  // ========================================
  console.log('\n\n=== 20. CONFIGURATION ===');

  const config = await ot(page, `client-aggregator/web/api/restaurants/${RID}/configuration`);
  log('CONFIGURATION', config);

  // ========================================
  // SAVE ALL RESULTS
  // ========================================
  const outPath = path.join(CAPTURES_DIR, 'action-captures.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n\n=== SAVED ${results.length} results to ${outPath} ===`);

  // Summary
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const icon = r.status >= 200 && r.status < 300 ? '✅' : '❌';
    console.log(`${icon} ${r.action}: ${r.status}`);
  }

  console.log('\nBrowser queda abierto. Ctrl+C para cerrar.');
})();
