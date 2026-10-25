"""
OTNavigator — OpenTable GuestCenter unified navigator
======================================================
Restaurant: Kitchen San José del Cabo (RID 1264498)
Combines direct API calls (via page.evaluate fetch) with Playwright UI
navigation for operations that have no working API endpoint.

Usage:
    nav = OTNavigator()
    nav.start(headless=False)
    results = nav.search_guest("Kayla Dillard")
    nav.stop()

Or as context manager:
    with OTNavigator() as nav:
        nav.create_reservation(guest_id, "2026-11-02", "19:00", 4)
"""

import re
import os
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from playwright.sync_api import sync_playwright, Page, BrowserContext

# =============================================================================
# CONSTANTS
# =============================================================================

RID = 1264498
MOD_BY = "698796db4c736d653554fa2b"          # Guillermo's staff ID
GUILLE_REFERRER_ID = 160258679806             # GlobalPersonId for concierge assignment
SESSION_DIR = os.path.join(os.path.dirname(__file__), ".ot-chrome-session")
CANCELLATION_POLICY_ID = "64b846257896686eaddea365:v12"

# Deposit: 300 MXN per person = 30000 centavos (denominator 100)
DEPOSIT_PER_PERSON_CENTAVOS = 30000
DEPOSIT_CURRENCY = "MXN"
DEPOSIT_DENOMINATOR = 100

# Dining areas
DINING_AREA_EXTERIOR = 103677   # Mesas Exterior (default)
DINING_AREA_BARRA = 69523       # Barra (bar, max 2 pax)

# Timezone: America/Mazatlan = UTC-7 (no DST)
BCS_UTC_OFFSET = -7

BASE_URL = "https://guestcenter.opentable.com"
GATEWAY = "/gateway/proxies"

CLIENT_INFO = {
    "Client": "Web App",
    "ClientVersion": "gc-microapp-front-of-house-Base-10144",
}


# =============================================================================
# NAVIGATOR CLASS
# =============================================================================

class OTNavigator:
    """
    Unified navigator for OpenTable GuestCenter.

    API operations go through page.evaluate(fetch(...)) so the browser's
    session cookies are used automatically — no separate auth needed.

    UI operations use Playwright clicks for flows that have no working API
    (new guest creation, table assignment, review responses).
    """

    def __init__(
        self,
        rid: int = RID,
        mod_by: str = MOD_BY,
        session_dir: str = SESSION_DIR,
        headless: bool = False,
    ):
        self.rid = rid
        self.mod_by = mod_by
        self.session_dir = session_dir
        self.headless = headless

        self._pw = None
        self._browser = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None

    # -------------------------------------------------------------------------
    # Context manager support
    # -------------------------------------------------------------------------

    def __enter__(self):
        self.start(self.headless)
        return self

    def __exit__(self, *_):
        self.stop()

    # =========================================================================
    # SESSION MANAGEMENT
    # =========================================================================

    def start(self, headless: bool = False):
        """Launch Chromium with the persistent session from SESSION_DIR."""
        self._clean_singleton_locks()

        self._pw = sync_playwright().start()
        self._context = self._pw.chromium.launch_persistent_context(
            self.session_dir,
            headless=headless,
            viewport={"width": 1440, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        pages = self._context.pages
        self._page = pages[0] if pages else self._context.new_page()

        self.ensure_session()

    def stop(self):
        """Close browser and Playwright."""
        try:
            if self._context:
                self._context.close()
        except Exception:
            pass
        try:
            if self._pw:
                self._pw.stop()
        except Exception:
            pass
        self._context = None
        self._page = None
        self._pw = None

    def ensure_session(self):
        """
        Navigate to GuestCenter and verify the session is active.
        If not logged in, waits up to 10 minutes for the user to log in manually.
        """
        page = self._page
        page.goto(f"{BASE_URL}/restaurant/{self.rid}/front-of-house/reservations")

        try:
            page.wait_for_selector("text=Kitchen", timeout=10_000)
            print("[OT] Session active.")
        except Exception:
            print("[OT] Not logged in. Please log in manually in the browser window...")
            page.wait_for_selector("text=Kitchen", timeout=600_000)
            print("[OT] Login detected. Continuing.")

    def _clean_singleton_locks(self):
        """Remove Chromium Singleton* lock files that block reuse of the profile."""
        if not os.path.isdir(self.session_dir):
            return
        for fname in os.listdir(self.session_dir):
            if fname.startswith("Singleton") or fname in ("lockfile", ".parentlock"):
                try:
                    os.remove(os.path.join(self.session_dir, fname))
                except OSError:
                    pass
        # Also check Default/ subdirectory
        default_dir = os.path.join(self.session_dir, "Default")
        if os.path.isdir(default_dir):
            for fname in os.listdir(default_dir):
                if fname.endswith("-wal") or fname.endswith("-shm"):
                    try:
                        os.remove(os.path.join(default_dir, fname))
                    except OSError:
                        pass

    # =========================================================================
    # LOW-LEVEL API HELPER
    # =========================================================================

    def _api(self, endpoint: str, method: str = "GET", body=None) -> dict:
        """
        Execute a fetch() inside the browser context so session cookies
        are included automatically.

        Args:
            endpoint: Path after /gateway/proxies/ (e.g. "gcFohWeb/api/1264498/...")
            method:   HTTP method
            body:     Dict to send as JSON body (optional)

        Returns:
            {"status": int, "data": dict|str}

        Raises:
            RuntimeError if the request returns a non-2xx status.
        """
        result = self._page.evaluate(
            """async ({ endpoint, method, body }) => {
                const opts = {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                };
                if (body !== null) {
                    opts.body = JSON.stringify(body);
                }
                const r = await fetch('/gateway/proxies/' + endpoint, opts);
                const text = await r.text();
                let data;
                try { data = JSON.parse(text); } catch { data = text; }
                return { status: r.status, data };
            }""",
            {"endpoint": endpoint, "method": method, "body": body},
        )

        if result["status"] >= 300:
            raise RuntimeError(
                f"[OT API] {method} {endpoint} → {result['status']}: "
                f"{str(result['data'])[:300]}"
            )
        return result

    def _put_reservation(self, reservation_id: str, fields: dict) -> dict:
        """
        Wrap any reservation PUT with the required outer envelope and
        always include ReservationId + CommandParameters.
        """
        body = {
            "reservation": {
                "ReservationId": reservation_id,
                "CommandParameters": {"ModifiedBy": self.mod_by},
                **fields,
            }
        }
        return self._api(
            f"foh-web/gcFohWeb/api/{self.rid}/v2/reservations/{reservation_id}",
            method="PUT",
            body=body,
        )

    # =========================================================================
    # TIME UTILITIES
    # =========================================================================

    def local_to_utc(self, date: str, time_str: str) -> tuple[str, str]:
        """
        Convert BCS local time (UTC-7) to UTC.

        Args:
            date:     "YYYY-MM-DD" (local date)
            time_str: "HH:MM" (24h, local BCS time)

        Returns:
            (utc_datetime_str, utc_date_str)
            e.g. ("2026-11-03T02:00:00Z", "2026-11-03")
        """
        h, m = map(int, time_str.split(":"))
        utc_h = h - BCS_UTC_OFFSET  # BCS_UTC_OFFSET is -7, so subtract -7 = add 7
        year, month, day = map(int, date.split("-"))

        dt_local = datetime(year, month, day, h, m, tzinfo=timezone(timedelta(hours=BCS_UTC_OFFSET)))
        dt_utc = dt_local.astimezone(timezone.utc)

        utc_str = dt_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        utc_date = dt_utc.strftime("%Y-%m-%d")
        return utc_str, utc_date

    def today(self) -> str:
        """Return today's date string in BCS timezone (America/Mazatlan, UTC-7)."""
        now_utc = datetime.now(timezone.utc)
        now_bcs = now_utc + timedelta(hours=BCS_UTC_OFFSET)
        return now_bcs.strftime("%Y-%m-%d")

    # =========================================================================
    # RESERVATIONS — API
    # =========================================================================

    def create_reservation(
        self,
        guest_id: str,
        date: str,
        time_str: str,
        pax: int,
        dining_area: str = "exterior",
        notes: Optional[str] = None,
        deposit: bool = True,
        origin: str = "PHONE",
        state: str = "NotConfirmed",
    ) -> dict:
        """
        Create a new reservation via API.

        Args:
            guest_id:    OT guest UUID
            date:        "YYYY-MM-DD" in BCS local time
            time_str:    "HH:MM" in BCS local time (24h)
            pax:         Party size
            dining_area: "exterior" (103677) or "barra" (69523)
            notes:       VenueNotes to add immediately after creation
            deposit:     If True, sets deposit to 300 MXN/pax PendingDinerPayment.
                         If False, sets deposit as Waived (60000 centavos flat).
            origin:      "PHONE", "WALK_IN", "ONLINE", etc.
            state:       Initial state

        Returns:
            The raw API response data (contains ConfirmationNumber, ReservationId, etc.)
        """
        area_id = DINING_AREA_BARRA if dining_area == "barra" else DINING_AREA_EXTERIOR
        utc_dt, _utc_date = self.local_to_utc(date, time_str)
        local_dt = f"{date}T{time_str}:00"
        res_id = str(uuid.uuid4())

        if deposit:
            deposit_details = {
                "TotalPrice": pax * DEPOSIT_PER_PERSON_CENTAVOS,
                "Currency": DEPOSIT_CURRENCY,
                "CurrencyDenominator": DEPOSIT_DENOMINATOR,
                "Status": "PendingDinerPayment",
            }
        else:
            deposit_details = {
                "TotalPrice": 60000,
                "Currency": DEPOSIT_CURRENCY,
                "CurrencyDenominator": DEPOSIT_DENOMINATOR,
                "Status": "Waived",
            }

        body = {
            "RID": self.rid,
            "State": state,
            "Origin": origin,
            "ReservationId": res_id,
            "PartySize": pax,
            "Scheduled": utc_dt,
            "ScheduledLocal": local_dt,
            "$restaurantDay": date,
            "GuestId": guest_id,
            "DiningAreaId": area_id,
            "ExperienceId": 0,
            "DiningArea": {"Selection": "specific", "Id": area_id},
            "SlotLockId": None,
            "SMSOptIn": True,
            "EmailConfirmationOptOut": False,
            "OverbookingReason": "None",
            "CancellationPolicyId": CANCELLATION_POLICY_ID,
            "DepositDetails": deposit_details,
            "BookingContext": {
                "NoTablesAvailable": False,
                "NoPrivateDiningAvailable": False,
                "OnlyNonreservableTablesAvailable": False,
                "EachAvailableTableViolatesATurnControl": False,
                "PartySizeViolatesExperienceConstraints": False,
                "NoTablesAvailableForExperience": False,
                "TimeViolatesExperienceConstraints": False,
                "AllowedBookingChannelViolations": [],
                "AllowAccessRuleViolation": False,
            },
            "CommandParameters": {
                "ModifiedBy": self.mod_by,
                "ClientInfo": CLIENT_INFO,
            },
            "Tags": [],
            "$allTags": [],
        }

        result = self._api(
            f"foh-web/gcFohWeb/api/{self.rid}/v2/reservations?disableVault=true",
            method="POST",
            body=body,
        )

        # Add notes if provided
        if notes and result["status"] == 200:
            try:
                self._put_reservation(res_id, {"VenueNotes": notes})
            except Exception as e:
                print(f"[OT] Warning: could not add notes: {e}")

        return result["data"]

    def cancel_reservation(self, reservation_id: str) -> dict:
        """Cancel a reservation. Note: British spelling 'Cancelled'."""
        result = self._put_reservation(reservation_id, {"State": "Cancelled"})
        return result["data"]

    def confirm_reservation(self, reservation_id: str) -> dict:
        """Confirm a reservation (NotConfirmed → Confirmed)."""
        result = self._put_reservation(reservation_id, {"State": "Confirmed"})
        return result["data"]

    def modify_reservation(self, reservation_id: str, **kwargs) -> dict:
        """
        Universal modifier for an existing reservation.

        Supported kwargs:
            time (str):          "HH:MM" BCS local — requires date too
            date (str):          "YYYY-MM-DD" — required when changing time
            pax (int):           New party size
            notes (str):         VenueNotes replacement
            state (str):         New state string
            no_show (bool):      If True, marks as NoShow with current timestamp
            dining_area (str):   "exterior" or "barra"

        Returns:
            API response data
        """
        fields: dict = {}

        if "state" in kwargs:
            fields["State"] = kwargs["state"]

        if kwargs.get("no_show"):
            # NoShow requires a UTC timestamp in the NoShow field
            fields["NoShow"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        if "notes" in kwargs:
            fields["VenueNotes"] = kwargs["notes"]

        if "pax" in kwargs:
            fields["PartySize"] = kwargs["pax"]

        if "time" in kwargs:
            date = kwargs.get("date", self.today())
            utc_dt, _ = self.local_to_utc(date, kwargs["time"])
            fields["Scheduled"] = utc_dt
            fields["ScheduledLocal"] = f"{date}T{kwargs['time']}:00"
            fields["$restaurantDay"] = date

        if "dining_area" in kwargs:
            area_id = DINING_AREA_BARRA if kwargs["dining_area"] == "barra" else DINING_AREA_EXTERIOR
            fields["DiningAreaId"] = area_id
            fields["DiningArea"] = {"Selection": "specific", "Id": area_id}

        if not fields:
            raise ValueError("modify_reservation: no fields to update provided.")

        result = self._put_reservation(reservation_id, fields)
        return result["data"]

    def list_reservations(self, date: str) -> list:
        """
        Get all reservations for a given date by scraping the UI sidebar.
        Falls back to bulk-sync API if UI scraping fails.

        Args:
            date: "YYYY-MM-DD"

        Returns:
            List of dicts with: name, pax, time, table, status, reservation_id
        """
        self.navigate_to_date(date)
        time.sleep(3)

        # Scrape reservation entries from the sidebar
        reservations = self._page.evaluate("""() => {
            const results = [];
            const entries = document.querySelectorAll('[class*="reservation"]');
            let inCancelled = false;

            for (const el of entries) {
                const text = el.textContent || '';

                // Detect "Eliminado" section
                if (text.includes('Eliminado')) {
                    inCancelled = true;
                    continue;
                }

                // Skip non-reservation elements
                const timeMatch = text.match(/(\\d{1,2}:\\d{2})/);
                const paxMatch = text.match(/(\\d+)\\s/);
                if (!timeMatch) continue;

                // Extract name (the longest word sequence that's not a number or time)
                const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
                let name = '';
                for (const line of lines) {
                    if (line.match(/^[A-Za-z\\s]+$/) && line.length > 3 && !line.match(/^\\d/)) {
                        name = line;
                        break;
                    }
                }

                // Extract table from badge/label
                const tableEl = el.querySelector('[class*="table"], [class*="badge"]');
                const table = tableEl ? tableEl.textContent?.trim() : '';

                results.push({
                    name: name || 'Unknown',
                    time: timeMatch ? timeMatch[1] : '',
                    pax: paxMatch ? parseInt(paxMatch[1]) : 0,
                    table: table,
                    status: inCancelled ? 'Cancelled' : 'Active',
                });
            }
            return results;
        }""")

        # Now click each active entry to get ReservationIds
        active = [r for r in reservations if r['status'] == 'Active']
        for i, res in enumerate(active):
            try:
                # Find and click the entry
                entries = self._page.locator(f'text={res["name"]}').all()
                for entry in entries:
                    in_cancelled = entry.evaluate("""n => {
                        let p = n;
                        for (let i = 0; i < 15; i++) {
                            p = p.parentElement;
                            if (!p) return false;
                            if (p.textContent?.includes('Eliminado')) return true;
                        }
                        return false;
                    }""")
                    if in_cancelled:
                        continue
                    entry.click()
                    time.sleep(1.5)
                    url = self._page.url
                    m = re.search(r'reservation/([a-f0-9-]+)', url)
                    if m:
                        active[i]['reservation_id'] = m.group(1)
                    break
            except Exception:
                pass

        # If UI scraping got nothing, try bulk-sync as fallback
        if not active:
            result = self._api(
                f"gcFohWeb/api/{self.rid}/bulk-sync?entities=Reservations",
                method="POST",
                body={
                    "Reservations": {
                        "restaurantDay": date,
                        "sinceSequenceId": 0,
                        "useNewReservationSyncApi": True,
                    }
                },
            )
            api_res = result.get("data", {}).get("Reservations", {}).get("Results", [])
            if api_res:
                return api_res

        return active

    def get_reservation_ids_by_guest(self, date: str, guest_name: str) -> list[str]:
        """
        Find reservation IDs for a guest on a given date by navigating the UI
        and clicking each matching entry to extract the ID from the URL.

        Skips reservations under "Eliminado" (deleted/cancelled) sections.

        Args:
            date:       "YYYY-MM-DD"
            guest_name: Partial name to match (case-insensitive)

        Returns:
            List of reservation UUID strings
        """
        page = self._page
        self.navigate_to_date(date)
        time.sleep(2)

        ids = []
        name_lower = guest_name.lower()

        # Find all reservation rows in the sidebar list, excluding the Eliminado section
        # The list has sections: active reservations, then "Eliminado" at the bottom
        # Strategy: find all clickable reservation entries, check if name matches,
        # skip any that appear after an "Eliminado" heading
        try:
            # Get all list items
            items = page.query_selector_all('[class*="reservation-list"] li, [class*="reservationList"] li')
            if not items:
                # Fallback: any clickable row that contains the guest name
                items = page.query_selector_all('[role="listitem"], [class*="reservation-item"]')

            in_eliminado = False
            for item in items:
                text = (item.inner_text() or "").strip()

                # Detect "Eliminado" section header
                if "eliminado" in text.lower() and len(text) < 30:
                    in_eliminado = True
                    continue

                if in_eliminado:
                    continue

                if name_lower not in text.lower():
                    continue

                # Click the item and grab the URL
                try:
                    item.click()
                    time.sleep(1)
                    current_url = page.url
                    match = re.search(r"/reservation/([a-f0-9\-]{36})", current_url)
                    if match:
                        res_id = match.group(1)
                        if res_id not in ids:
                            ids.append(res_id)
                except Exception as e:
                    print(f"[OT] Warning clicking reservation: {e}")

        except Exception as e:
            print(f"[OT] get_reservation_ids_by_guest error: {e}")

        # Fallback: use bulk-sync API and match by GuestDescription
        if not ids:
            reservations = self.list_reservations(date)
            for r in reservations:
                desc = (r.get("GuestDescription") or "").lower()
                if name_lower in desc and r.get("State") not in ("Cancelled", "Deleted"):
                    ids.append(r["ReservationId"])

        return ids

    # =========================================================================
    # GUEST — API + UI fallback
    # =========================================================================

    def search_guest(self, query: str) -> list:
        """
        Search guests by name, phone, or email.

        Args:
            query: Search string

        Returns:
            List of guest dicts with keys: guest_id, first_name, last_name, etc.
        """
        from urllib.parse import quote
        result = self._api(
            f"gcFohWeb/api/{self.rid}/v4/guests/search?query={quote(query)}"
        )
        return result["data"].get("results", [])

    def get_guest_profile(self, guest_id: str) -> dict:
        """
        Get full guest profile including contact, insights, notes, tags.

        Args:
            guest_id: OT guest UUID

        Returns:
            Profile dict with modules: contactV2, guest, insights, intelligence,
            notes, rewards, tags
        """
        modules = "contactV2,guest,insights,intelligence,notes,rewards,tags"
        result = self._api(
            f"crm/guestProfile/api/v1/modular-guest-profile/restaurants"
            f"/{self.rid}/guests/{guest_id}?modules={modules}"
        )
        return result["data"]

    def create_guest(
        self,
        first_name: str,
        last_name: str,
        phone: str,
        country_code: str = "1",
        email: Optional[str] = None,
    ) -> Optional[str]:
        """
        Create a new guest via the booking wizard UI ("Añadir a la base de datos").

        The wizard flow is:
            Open wizard → navigate to party size step → pick any time →
            reach guest search → type name → click "Añadir a la base de datos" →
            fill phone/email → click Listo → escape → search to get new guest_id

        Args:
            first_name:   Guest's first name
            last_name:    Guest's last name
            phone:        Phone number digits only (no country code)
            country_code: Country dial code, default "1" (US/Mexico)
            email:        Optional email address

        Returns:
            guest_id (str) if successful, None otherwise
        """
        page = self._page
        full_name = f"{first_name} {last_name}"
        print(f"[OT] Creating guest via wizard: {full_name}...")

        # Navigate to a date that definitely has availability (use tomorrow)
        tomorrow = (datetime.now(timezone.utc) + timedelta(hours=BCS_UTC_OFFSET) + timedelta(days=30)).strftime("%Y-%m-%d")
        page.goto(f"{BASE_URL}/restaurant/{self.rid}/front-of-house/reservations/{tomorrow}")
        time.sleep(3)

        # Open the booking wizard
        try:
            page.click('[data-testid="addReservationAction"]', timeout=8000)
        except Exception:
            # Try alternative button selectors
            try:
                page.click('button:has-text("Hacer reserva"), button:has-text("Add reservation")', timeout=5000)
            except Exception as e:
                print(f"[OT] Could not open wizard: {e}")
                return None
        time.sleep(2)

        # Step through wizard: party size → time → guest search
        # We need to reach the "Cliente" (guest) tab
        wizard_reached_guest = False

        for _ in range(5):
            # Check if guest search input is visible
            search_input = page.query_selector(
                'input[placeholder*="earch"], input[placeholder*="uscar"], '
                'input[placeholder*="liente"], input[placeholder*="guest"]'
            )
            if search_input:
                wizard_reached_guest = True
                break

            # Try clicking "Cliente" tab directly
            try:
                page.click('text=Cliente', timeout=2000)
                time.sleep(1)
                continue
            except Exception:
                pass

            # Try picking party size (click 2 pax button)
            try:
                btns = page.query_selector_all('button[class*="party"], [data-testid*="party"], [class*="partySize"] button')
                if btns:
                    btns[0].click()
                    time.sleep(1)
                    continue
            except Exception:
                pass

            # Try picking any available time slot
            try:
                slots = page.query_selector_all('[class*="time-slot"], [data-testid*="time-slot"], button[class*="slot"]')
                if slots:
                    slots[0].click()
                    time.sleep(1)
                    continue
            except Exception:
                pass

            # Try "Overbook" button if available slots are full
            try:
                page.click(
                    'button:has-text("Sobrerreservar"), button:has-text("Overbook"), '
                    'button:has-text("Override")',
                    timeout=1500,
                )
                time.sleep(1)
            except Exception:
                pass

            time.sleep(1)

        if not wizard_reached_guest:
            print("[OT] Could not reach guest search step in wizard.")
            page.screenshot(path=os.path.join(os.path.dirname(__file__), "captures", "wizard-stuck.png"))
            try:
                page.keyboard.press("Escape")
            except Exception:
                pass
            return None

        # Type the guest's full name
        search_input = page.query_selector(
            'input[placeholder*="earch"], input[placeholder*="uscar"], '
            'input[placeholder*="liente"], input[placeholder*="guest"]'
        )
        search_input.fill(full_name)
        time.sleep(2)

        # Click "Añadir a la base de datos" / "Add to database"
        add_btn = None
        for selector in [
            'text=Añadir a la base de datos',
            'text=Add to database',
            'text=Agregar a la base de datos',
            'text=Add guest',
            '[data-testid*="add-guest"]',
            '[class*="add-guest"]',
        ]:
            try:
                add_btn = page.query_selector(selector)
                if add_btn:
                    break
            except Exception:
                pass

        if not add_btn:
            # Maybe guest already exists — check results
            results = page.query_selector_all('[class*="guest-result"], [class*="search-result"], [class*="GuestResult"]')
            if results:
                print(f"[OT] Found {len(results)} existing guest results. Selecting first match.")
                results[0].click()
                time.sleep(1)
                # Close wizard
                try:
                    page.keyboard.press("Escape")
                except Exception:
                    pass
                # Search API to get guest_id
                return self._find_guest_id_after_create(first_name, last_name, phone)
            else:
                print("[OT] 'Add to database' button not found.")
                page.screenshot(path=os.path.join(os.path.dirname(__file__), "captures", "no-add-btn.png"))
                try:
                    page.keyboard.press("Escape")
                except Exception:
                    pass
                return None

        add_btn.click()
        time.sleep(2)

        # Fill in guest details form
        self._fill_guest_form(page, first_name, last_name, phone, country_code, email)

        # Click "Listo" / "Done" / "Save"
        saved = False
        for selector in [
            'button:has-text("Listo")',
            'button:has-text("Done")',
            'button:has-text("Guardar")',
            'button:has-text("Save")',
            '[data-testid*="done"]',
            '[data-testid*="save"]',
        ]:
            try:
                page.click(selector, timeout=3000)
                saved = True
                time.sleep(2)
                break
            except Exception:
                pass

        if not saved:
            print("[OT] Could not find Save/Done button.")

        # Close the wizard
        try:
            page.keyboard.press("Escape")
        except Exception:
            pass
        time.sleep(1)

        # Retrieve the new guest_id via search API
        return self._find_guest_id_after_create(first_name, last_name, phone)

    def _fill_guest_form(
        self,
        page: Page,
        first_name: str,
        last_name: str,
        phone: str,
        country_code: str,
        email: Optional[str],
    ):
        """Fill in the guest creation form fields."""
        # First name
        for selector in ['input[name*="first"], input[placeholder*="Nombre"], input[placeholder*="First"]']:
            el = page.query_selector(selector)
            if el:
                el.fill(first_name)
                time.sleep(0.3)
                break

        # Last name
        for selector in ['input[name*="last"], input[placeholder*="Apellido"], input[placeholder*="Last"]']:
            el = page.query_selector(selector)
            if el:
                el.fill(last_name)
                time.sleep(0.3)
                break

        # Country code / dial code selector
        if country_code:
            try:
                # May be a <select> or a custom dropdown
                select = page.query_selector("select")
                if select:
                    # Try selecting by value or label
                    if country_code == "1":
                        select.select_option(label="United States") if country_code == "1" else None
                    else:
                        select.select_option(value=country_code)
                    time.sleep(0.3)
            except Exception:
                pass

        # Phone
        for selector in [
            'input[type="tel"]',
            'input[name*="phone"]',
            'input[placeholder*="eléfono"]',
            'input[placeholder*="hone"]',
        ]:
            el = page.query_selector(selector)
            if el:
                el.fill(phone)
                time.sleep(0.3)
                break

        # Email
        if email:
            for selector in [
                'input[type="email"]',
                'input[name*="email"]',
                'input[placeholder*="mail"]',
            ]:
                el = page.query_selector(selector)
                if el:
                    el.fill(email)
                    time.sleep(0.3)
                    break

    def _find_guest_id_after_create(
        self, first_name: str, last_name: str, phone: str
    ) -> Optional[str]:
        """Search for a newly created guest and return their guest_id."""
        # Try by full name first
        results = self.search_guest(f"{first_name} {last_name}")
        match = next(
            (
                g for g in results
                if g.get("first_name", "").lower() == first_name.lower()
                and g.get("last_name", "").lower() == last_name.lower()
            ),
            None,
        )
        if match:
            print(f"[OT] Guest created: {match['first_name']} {match['last_name']} ({match['guest_id']})")
            return match["guest_id"]

        # Try by phone
        phone_results = self.search_guest(phone)
        if phone_results:
            g = phone_results[0]
            print(f"[OT] Guest found by phone: {g.get('first_name')} {g.get('last_name')} ({g.get('guest_id')})")
            return g.get("guest_id")

        print("[OT] Could not find guest after creation.")
        return None

    # =========================================================================
    # STAFF & CONCIERGE — API
    # =========================================================================

    def list_staff(self) -> list:
        """
        Get all staff members for the restaurant.

        Returns:
            List of staff dicts with keys: Id, Name, Role, DisplayColor, Hidden, Deleted
        """
        result = self._api(
            f"gcVenue/umami_venue/api/v4/Restaurant/{self.rid}/Staff"
            f"?sinceSequenceId=0&count=1000&includeDeleted=false"
        )
        # Response may be a list directly or wrapped
        data = result["data"]
        if isinstance(data, list):
            return data
        return data.get("Staff", data.get("results", []))

    def assign_staff(
        self,
        reservation_id: str,
        staff_id: str = MOD_BY,
        name: str = "Guillermo von Papendieck",
    ) -> dict:
        """
        Assign a staff member (server) to a reservation.

        Args:
            reservation_id: Reservation UUID
            staff_id:       Staff UUID (default: Guillermo)
            name:           Staff display name for the Server field

        Returns:
            API response data
        """
        result = self._put_reservation(
            reservation_id,
            {
                "StaffId": staff_id,
                "Server": name,
            },
        )
        return result["data"]

    def list_concierges(self) -> list:
        """
        Get all referrers/concierges (349 total).

        Returns:
            List of referrer dicts with GlobalPersonId, name, etc.
        """
        result = self._api(
            f"referralManagement/user/v1/restaurants/{self.rid}/referrers"
        )
        data = result["data"]
        if isinstance(data, list):
            return data
        return data.get("referrers", data.get("Referrers", []))

    def search_concierge(self, query: str) -> list:
        """
        Search concierges/referrers by name (case-insensitive substring match).

        Args:
            query: Name fragment to search for

        Returns:
            Filtered list of matching referrer dicts
        """
        all_refs = self.list_concierges()
        q = query.lower()
        return [
            r for r in all_refs
            if q in (r.get("name") or r.get("Name") or "").lower()
        ]

    def assign_concierge(
        self,
        reservation_id: str,
        concierge_name_or_id,
    ) -> dict:
        """
        Assign a concierge/referrer to a reservation.

        Args:
            reservation_id:       Reservation UUID
            concierge_name_or_id: Either a name string (will search) or
                                  a GlobalPersonId integer

        Returns:
            API response data
        """
        if isinstance(concierge_name_or_id, str):
            matches = self.search_concierge(concierge_name_or_id)
            if not matches:
                raise ValueError(f"Concierge not found: {concierge_name_or_id!r}")
            referrer = matches[0]
            gpid = referrer.get("globalPersonId") or referrer.get("GlobalPersonId")
        else:
            gpid = concierge_name_or_id

        result = self._put_reservation(
            reservation_id,
            {
                "ReferrerId": gpid,
                "ReferrerName": concierge_name_or_id if isinstance(concierge_name_or_id, str) else None,
            },
        )
        return result["data"]

    # =========================================================================
    # DEPOSITS — API
    # =========================================================================

    def activate_deposit(
        self,
        reservation_id: str,
        amount_per_person: int = DEPOSIT_PER_PERSON_CENTAVOS,
        pax: Optional[int] = None,
    ) -> dict:
        """
        Activate a deposit for a reservation (sets to PendingDinerPayment).

        Args:
            reservation_id:   Reservation UUID
            amount_per_person: Centavos per person (default 30000 = $300 MXN)
            pax:              Party size. If None, uses amount_per_person directly as total.

        Returns:
            API response data
        """
        total = (pax * amount_per_person) if pax else amount_per_person
        result = self._put_reservation(
            reservation_id,
            {
                "DepositDetails": {
                    "TotalPrice": total,
                    "Currency": DEPOSIT_CURRENCY,
                    "CurrencyDenominator": DEPOSIT_DENOMINATOR,
                    "Status": "PendingDinerPayment",
                },
                "CancellationPolicyId": CANCELLATION_POLICY_ID,
            },
        )
        return result["data"]

    def waive_deposit(self, reservation_id: str) -> dict:
        """
        Waive the deposit for a reservation.

        Returns:
            API response data
        """
        result = self._put_reservation(
            reservation_id,
            {
                "DepositDetails": {
                    "TotalPrice": 60000,
                    "Currency": DEPOSIT_CURRENCY,
                    "CurrencyDenominator": DEPOSIT_DENOMINATOR,
                    "Status": "Waived",
                },
                "CancellationPolicyWaivedReason": "InHouse",
            },
        )
        return result["data"]

    # =========================================================================
    # AVAILABILITY — API
    # =========================================================================

    def check_availability(self, date: str, pax: int) -> dict:
        """
        Check available time slots for a given date and party size.

        Args:
            date: "YYYY-MM-DD"
            pax:  Party size

        Returns:
            Availability response dict (timeslots, etc.)
        """
        result = self._api(
            f"fohAggregator/v4/{self.rid}/detailedAvailability",
            method="POST",
            body={
                "restaurantDay": date,
                "partySize": pax,
                "requestedTime": f"{date}T19:00:00",
                "diningAreaId": DINING_AREA_EXTERIOR,
            },
        )
        return result["data"]

    # =========================================================================
    # REVIEWS — API (read) + UI (respond)
    # =========================================================================

    def get_reviews_summary(self) -> dict:
        """
        Get overall reviews summary (average rating, total count, etc.).

        Returns:
            Reviews summary dict
        """
        result = self._api(
            f"hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/{self.rid}/reviews/summary",
            method="POST",
            body={},
        )
        return result["data"]

    def get_recent_reviews(self, limit: int = 5) -> list:
        """
        Get the most recent reviews.

        Args:
            limit: Number of reviews to return

        Returns:
            List of review dicts
        """
        result = self._api(
            f"hospitality/ot4rFeedbackService/api/v1/feedback/restaurant/{self.rid}/reviews/details",
            method="POST",
            body={
                "pagination": {"pageSize": limit, "pageToken": None},
                "filters": {},
            },
        )
        data = result["data"]
        return data.get("reviews", data.get("Reviews", []))

    def respond_to_review(self, review_id: str, response_text: str) -> bool:
        """
        Respond to a review via UI navigation (endpoint not captured yet).

        Args:
            review_id:     The review identifier
            response_text: Text to post as restaurant response

        Returns:
            True if the UI flow completed without error, False otherwise
        """
        page = self._page
        print("[OT] Navigating to reviews to respond via UI...")
        page.goto(f"{BASE_URL}/restaurant/{self.rid}/feedback/reviews")
        time.sleep(3)

        try:
            # Find the review and click respond
            page.click(f'[data-review-id="{review_id}"], [id*="{review_id}"]', timeout=5000)
            time.sleep(1)
        except Exception:
            pass

        try:
            page.click(
                'button:has-text("Respond"), button:has-text("Responder"), '
                'button:has-text("Reply"), button:has-text("Contestar")',
                timeout=8000,
            )
            time.sleep(1)

            textarea = page.query_selector("textarea")
            if textarea:
                textarea.fill(response_text)
                time.sleep(0.5)
                page.click(
                    'button:has-text("Submit"), button:has-text("Enviar"), '
                    'button:has-text("Post"), button:has-text("Publicar")',
                    timeout=5000,
                )
                time.sleep(2)
                print("[OT] Review response submitted via UI.")
                return True
        except Exception as e:
            print(f"[OT] Could not respond to review via UI: {e}")

        return False

    # =========================================================================
    # INBOX — API
    # =========================================================================

    def get_messages(self, limit: int = 25, offset: int = 0) -> list:
        """
        Get inbox messages/conversations.

        Returns:
            List of conversation summary dicts
        """
        result = self._api(
            f"gc-inbox/gcDmService/v2/restaurants/{self.rid}"
            f"/conversation?limit={limit}&offset={offset}"
        )
        data = result["data"]
        if isinstance(data, list):
            return data
        return data.get("conversations", data.get("Conversations", []))

    def get_conversation(self, confirmation_number) -> dict:
        """
        Get a specific conversation by reservation confirmation number.

        Args:
            confirmation_number: Integer confirmation number

        Returns:
            Conversation dict with messages
        """
        result = self._api(
            f"gc-inbox/gcDmService/v2/restaurants/{self.rid}"
            f"/conversation/confirmation/{confirmation_number}"
        )
        return result["data"]

    # =========================================================================
    # UI NAVIGATION HELPERS
    # =========================================================================

    def navigate_to_date(self, date: str):
        """
        Navigate to the reservations view for a specific date.

        Args:
            date: "YYYY-MM-DD"
        """
        target = f"{BASE_URL}/restaurant/{self.rid}/front-of-house/reservations/{date}"
        if self._page.url != target:
            self._page.goto(target)
            time.sleep(2)

    def get_page(self) -> Page:
        """Return the underlying Playwright page for advanced manual operations."""
        return self._page


# =============================================================================
# DEMO / MAIN
# =============================================================================

def main():
    """
    Demo: search a guest and list today's reservations.
    Run with: python navigator.py
    """
    print("=" * 60)
    print("OTNavigator — Kitchen San José del Cabo")
    print(f"RID: {RID}")
    print("=" * 60)

    with OTNavigator(headless=False) as nav:
        today = nav.today()
        print(f"\nToday (BCS): {today}")

        # Demo 1: Search guest
        print("\n[1] Searching guest 'Kayla Dillard'...")
        try:
            guests = nav.search_guest("Kayla Dillard")
            if guests:
                g = guests[0]
                print(f"    Found: {g.get('first_name')} {g.get('last_name')} — ID: {g.get('guest_id')}")
            else:
                print("    No results found.")
        except Exception as e:
            print(f"    Error: {e}")

        # Demo 2: List today's reservations
        print(f"\n[2] Listing reservations for {today}...")
        try:
            reservations = nav.list_reservations(today)
            active = [r for r in reservations if r.get("State") not in ("Cancelled", "Deleted")]
            print(f"    Total: {len(reservations)} | Active: {len(active)}")
            for r in active[:5]:
                print(
                    f"    {r.get('ScheduledLocal', '')[:16]} | "
                    f"{r.get('PartySize')}pax | "
                    f"{r.get('GuestDescription', 'N/A')} | "
                    f"{r.get('State')}"
                )
        except Exception as e:
            print(f"    Error: {e}")

        # Demo 3: Check availability for tomorrow
        tomorrow = (
            datetime.now(timezone.utc)
            + timedelta(hours=BCS_UTC_OFFSET)
            + timedelta(days=1)
        ).strftime("%Y-%m-%d")
        print(f"\n[3] Checking availability for {tomorrow}, 4 pax...")
        try:
            avail = nav.check_availability(tomorrow, 4)
            slots = avail.get("timeSlots") or avail.get("TimeSlots") or []
            print(f"    Available slots: {len(slots)}")
            for slot in slots[:5]:
                t = slot.get("time") or slot.get("Time") or slot.get("ScheduledLocal", "")
                print(f"    {t}")
        except Exception as e:
            print(f"    Error: {e}")

        print("\n[DONE] Navigator demo complete.")


if __name__ == "__main__":
    main()
