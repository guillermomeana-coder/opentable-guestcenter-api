"""Test navigator — list reservations + check problem ones"""
import sys
sys.stdout.reconfigure(line_buffering=True)

from navigator import OTNavigator

nav = OTNavigator()
nav.start(headless=False)

dates = ['2026-11-02', '2026-11-05', '2026-11-12', '2026-11-18', '2026-11-23',
         '2026-12-09', '2026-12-17', '2026-12-26', '2026-12-28']

print("\n=== SCANNING ALL DATES ===\n")

all_problems = []

for date in dates:
    print(f"Checking {date}...")
    res = nav.list_reservations(date)
    active = [r for r in res if r.get('status') == 'Active']
    if not active:
        print(f"  No active reservations")
        continue

    print(f"  {len(active)} active:")
    for r in active:
        table = r.get('table', '-') or '-'
        rid = r.get('reservation_id', '?')
        problem = 'NO MESA' if not table or table == '-' else 'OK'
        print(f"    {r.get('time','')} {r.get('name','')} {r.get('pax','')}pax mesa:{table} {problem} [{rid[:8] if rid != '?' else '?'}]")
        if problem == 'NO MESA':
            all_problems.append({**r, 'date': date})

print(f"\n=== {len(all_problems)} PROBLEM RESERVATIONS (no table) ===")
for p in all_problems:
    print(f"  {p['date']} {p.get('time','')} {p.get('name','')} {p.get('pax','')}pax")

print("\nBrowser stays open. Close window to exit.")

# Keep alive until browser closes
import time
try:
    while True:
        time.sleep(5)
        try:
            nav.page.url  # test if browser still open
        except:
            break
except KeyboardInterrupt:
    pass

nav.stop()
