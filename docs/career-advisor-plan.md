# Career Advisor — design (built 2026-11-11)

Code: `src/shared/careerAdvisor.ts` (perks, ranks, caps, estimates),
`src/background/features/careerAuto/goals.ts` (goal mode, energy top-up),
hooks in `careerAuto/runner.ts`, page `src/dashboard/sections/CareerAdvisor.tsx`
(Dashboard → Career Auto → Advisor tab; `#/automations/career-auto?advisor`).

Rank thresholds (from every `career.php` response, Aug 10 – Nov 10): R1 at
1 shift, R2 at 10, R3 at 35, R4 at 85, R5 at 185, as running totals. A job
with no shifts reads "0 / 10 to Foundation" on its card but gets R1 on its
first shift, so the page shows "Not started".

**Changed 2026-11-11 (player's call):** energy items and the free refill are
Career Auto settings, not goal settings. They top up whatever job Career
Auto runs (goal or not) while Auto-Run is on, to that check's shift cost
(the Overtime cost in Overtime mode). Code: `careerAuto/energyTopUp.ts`;
settings on the Career Auto page; today's counts in `ff_career_energy_status`.
The "Only while goal mode is on" lines below are superseded.

**Changed again for 0.65.1 (player's call):** the free refill is used straight
after a shift, with the energy the `career.php` response reports (every one
of 2,309 ok responses has `stats.energy`), when it's below the next shift's
cost — the lowest energy gets, usually 0 — so none of the refill is lost.
While energy is short before a shift it just waits for regen (items still
cover the gap if on). Only exception: the refill is still unused and regen
won't reach the shift's cost before the 23:00 UTC reset. The "use it when
energy is below one shift" rule below is superseded.

As built, beyond the design below: finished goals are removed from the list
and kept under "Recently earned" (last 10); while goal mode has goals, the
finder's Run now is off (goal mode would switch straight back); if only
level-locked goals remain, Career Auto keeps its current job and no
"all done" reminder is sent (the goals aren't done).

A new **Advisor** tab under Career Auto in the dashboard. The player picks the
perks they want, sees every job that gives them, and can hand a list of
"job → rank" goals to Career Auto, which works through them (optionally
using energy items) and tells the player when each perk is earned.

Nothing here changes what Career Auto does today unless one of the new
toggles is switched on. Every new toggle defaults to **off**.

## What the game already has, and what's missing

The game's Careers page has a **Perks** tab: a read-only table of the perks
already earned, per career (screenshot 2026-11-10: "121 perks unlocked across
40 careers"). It has no totals per perk, no unearned perks, no progress, no
search, filter or sort. That gap is what this fills.

## Where the data comes from (all checked against real data)

The live Careers page (`GET /api/panel.php?type=careers`, already read by
Career Auto) has every job, locked ones included. Per card:

| Field | Markup | Checked |
|---|---|---|
| name, family, required level | `cv2-card-name`, family section header, `cv2-card-lv` | existing parser |
| energy, OT energy, cooldown | stat tiles, `cv2-ot-row`, meta pill (`11m CD`) | existing parser / 2026-11-10 capture |
| the 4 perks with values | `cv2-passive-row` R1–R4, `cv2-passive-text` ("+4.00% Crime Success") | 2026-11-10 capture |
| which perks are earned | `cv2-passive-row` (tick) vs `cv2-passive-row locked` (lock) | 2026-11-10 capture |
| current rank, shifts toward next | rank badge ("Senior"), "Next: Expert 38 / 85" | matches `career.php` response `shifts: 38`, `rank: 3` |
| perk keys | `data-perks="travel_speed career_pay agility crime_success"` | 2026-11-10 capture |

Shifts left to rank R = the card's `b − a`, stepped through each rank. Use the
card's own numbers, not a fixed table: some Expert cards show `0 / 185`
(counted shifts toward Master restarted), so totals don't follow from rank.

The wiki (`careers` section) lists the same 100 jobs and perks; it's a
cross-check for the parser, not a runtime dependency.

**Archive limit:** stored copies of this page are cut at 512 KB, so the archive
never holds a whole one. The parser has to be checked against a full live copy
(the extension sees the whole page) before shipping.

## Screens

### 1. Perk finder

- Pick one or more perks (searchable list of the 54 perk types, with how many
  jobs give each).
- Table, one row per job × wanted perk:
  job · family · level · perk value · rank it unlocks at · your rank and
  progress · shifts left · energy left · time on regen · time with items ·
  "also gives" (the job's other perks still locked) · status.
- Status: **Earned** / **Can do now** / **Locked — needs level N**.
- Filters: hide earned (default on), hide level-locked, family. Sort by any
  column; default: time on regen, shortest first.
- Row actions: **Run now** (switch Career Auto to this job, asks first, same
  as the on-page "Auto-run this job" button) and **Add to goals**.

### 2. Perk totals

Per perk: total from careers now · still reachable at your level · max at
level 200 · number of jobs giving it. Sort and search.

Caps: the game caps some bonuses for the sum of **all** sources (careers,
Academy, Bloodline, Family Tree); anything past the cap is wasted. The wiki
states them (fetched 2026-11-10). Academy's "Working Cap" per lane matches the
in-game properties page exactly (Property Income 75%, Passive Income 90%;
screenshot 2026-11-10), so it is the cap on the total:

| Bonus | Cap | Source |
|---|---|---|
| Strength / Defence / Agility / Dexterity % | 150% | wiki `academy` |
| Max Vitality % | 200% | wiki `academy` |
| Crime Success | 150 pp | wiki `academy` |
| Career Pay, Crime Payout, Racket Income, Property Income, Casino Payout | 75% | wiki `academy` |
| Active Income, Passive Income | 90% | wiki `academy` |
| Smuggling Capacity | 45% | wiki `academy` |
| Gym Speed | 40% | wiki `academy` |
| All Gear Stats %, All Pet Stats % | 12.5% | wiki `academy` |
| Black Market Discount | 25% | wiki `academy` |
| Steal Yield | +200% | wiki `theft` |
| Steal Protection | 75% | wiki `theft` |
| Dodge / Block / Critical Chance | 30% chance (raised by family Cap Breakers) | wiki `combat`, `familybuffs` |
| DEF Efficiency | no cap | wiki `combat` |

Every other career perk (XP Bonus, Bank Interest, Travel Speed, regen, Heat
Reduction, …) has no cap stated anywhere on the wiki: show "no cap listed".

The table ships as static data with its wiki date; `wiki.py diff academy theft
combat` shows when the game changes it. The career share comes from the
Careers page; the other sources only where a game page shows them (the
properties page does for Property/Passive Income). Show "careers X% · total Y%
of cap Z%" where the total is known, otherwise "careers X% · cap Z%", and warn
when a goal would add past the cap.

### 3. Goals

An ordered list of "job → target rank", added from the finder.

- Shows each goal's shifts left, energy left and time estimate, plus the queue
  total.
- Reorder, remove.
- **Goal mode** toggle (off by default). While on, Career Auto runs the first
  unfinished goal's job and moves to the next when its target rank is reached.
  While off, the list is just a plan.

## Goal mode behaviour

- After every shift, read `rank` and `shifts` from the `career.php` response;
  when the target rank is reached, notify ("Crime Success +3.5% earned —
  Technology Project Manager reached Senior") and switch to the next goal.
- Skip a goal whose job is level-locked (notify once) or already done.
- Shift mode: normal shifts only while a goal is active. Ranks count shifts,
  and Overtime is one shift for double the energy.
- **Queue finished:** keep running the last goal's job (as Career Auto does
  today) and remind the player:
  - one notification when the queue finishes;
  - a reminder every 4 hours while it stays finished, reusing the same
    notification id so it replaces the last one instead of piling up;
  - a banner on the Career Auto page and the dashboard;
  - stops as soon as the player adds a goal, picks a job, turns goal mode
    off, or presses **Keep running this job** (silences it).

  Time-based and replaced in place, so it can't loop or flood.

## Energy items (own toggle, off by default)

Only while goal mode is on and working on a goal.

- **Why it pays:** energy, not cooldown, limits shifts. At 1 energy per 199 s
  (~18/h, max 175; stats 2026-11-10, level 141) a 37-energy job runs about once
  every 2 h on regen, but its 15 min cooldown allows 4/h. Careers are the only
  energy spending in the Nov 8–10 exports.
- **When:** the job is off cooldown and energy is below one shift's cost.
- **How much:** just enough to cover the gap, smallest item first (Energy Drink
  +10, Energy Booster +15, Adrenaline Shot +25), never past max energy (the game
  wastes the excess: "+28 Energy" at the cap, 2026-11-10).
- **Keep in stock:** never take Energy Drinks below 50 (adjustable). No
  reserve for the other items.
- **Not used:** event foods with other buffs (e.g. Calaverita de Azúcar), and
  Energy Supplement (2× regen for 1 h).
- **Pacing:** one item at a time with a short gap, like a player tapping.
- Anything unexpected pauses and notifies, same as every automation.

## Free daily energy refill (own toggle, off by default)

One free energy refill per day; it comes back at the daily reset (23:00 UTC,
seen 2026-11-08) and restores energy to full.

- Use it when energy is near 0 and the job is ready, so the whole refill
  counts.
- If it's still unused close to the reset (e.g. 22:00 UTC), use it at the next
  moment energy is below one shift, so it isn't lost.
- Only while goal mode is on.

## Requests to imitate (check every field before building)

- `POST /actions/inventory.php` `action=quick_list&stat=energy`, then
  `action=use&inv_id=…` (player's own, 2026-11-08 to 11-10).
- `POST /actions/free_refill.php` `action=list`, then `action=refill&stat=energy`.

Per CLAUDE.md: union every field these endpoints have ever sent and echoed in
the archive, not just these, before writing the requests.

## Safety

- One re-entrancy guard covers every trigger (alarm, Run now, goal switch,
  item use), as in `careerAuto/runner.ts`.
- Item use and refills run inside the same guarded cycle as the shift, so a
  second trigger can't double-spend.
- Every UI surface showing these toggles listens to `chrome.storage.onChanged`.

## Decided with the player (2026-11-10)

- Queue finished: keep running the last job, remind every 4 h.
- Energy items: any of Energy Drink / Booster / Adrenaline; keep 50 Energy
  Drinks in stock (adjustable).
- Free refill: its own toggle.
- R5 gear browser and multi-perk weighting: not wanted.
