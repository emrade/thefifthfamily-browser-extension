# Upcoming game changes

Announced but not live. For each: what's coming, which feature it hits, and
what to do the day it lands. When one ships, write it up as a dated file in
this folder (see [README](README.md)) and delete its entry here.

Source unless noted: forum post "The Fifth Family: Upcoming Features &
Halloween Update Breakdown" (a mod, Announcements, captured 2026-10-31
11:08 UTC in `fifth-family-archive-new-2026-10-31T12-45-34-269Z`). Most of
these are previews with no release date.

## Will break or need rework

### Racing V3 + vehicle rebuild — Street Racing auto, Garage

- Races become a section-by-section simulation driven by minigames (Lights
  Out, Shift, Drift, Dodge, Swerve, Draft & Pass, Final Straight), each
  graded Fail (0–49) / Neutral / Good / Excellent; grades set acceleration
  (×0.8–1.2) and obstacle speed loss (×1.2–0.8). No final win-chance roll.
- Weather modifies stats (Clear +15% … Snowy −10%); surfaces (asphalt, dirt,
  grass × dry/wet/frozen) add speed loss.
- 35 vehicles revised, 24 new; parts split into Body (combat stats) and five
  racing components (tradeable), with quality (Standard / Custom /
  Engineered, ×1.00–1.08) and +0 to +5 upgrades.

**Day it lands:** switch Street Racing auto off before racing. Its imitated
`can_race` → `attempt_race` (run token + sampled accuracy) won't match the
new flow, and the risk is the run-token incident again — the server
accepting an incomplete request and grading every section Fail without an
error (see CLAUDE.md). Capture several page races, union every field the
new endpoints send, and rebuild from that. Check the Garage parser against
the new vehicle/part markup.

### The Importer — Pet Courier

Expeditions send up to 5 pets for 4–8 h to buy materials (shared global
stock, resets every 6 h; 1 slot, up to 6). Equipped pets and pets already on
an expedition can't be picked.

**Day it lands:** check whether a pet on an expedition also shows as busy in
smuggling, and how the fleet markup shows it. Pet Courier should pause on the
unfamiliar state rather than misfire; expect one pause, then teach the parser
the new state. Smuggling and Importer now compete for the same pets.

## Affects advice and numbers

### Instinct in combat — Arena advisor

In PvP and PvE the side with less Instinct loses 0.5% of final STR, DEF,
AGI and DEX per point of difference (no bonus to the higher side). Also
+0.1% cash per point after other modifiers.

**When live:** the kill-race score can't see an opponent's Instinct, so
close fights get noisier. Re-check regular score-band records in
`verify_combat_rule.py`; the game's simulated card % (since 2026-10-30)
should include it. A change in your own Instinct shows up as a jump in your
numbers, which `foldFight` already restarts on.

### Prepared consumables & status effects — Arena advisor

One offensive item per fight with a trigger (first action, HP 75/50/25%,
first strike) and one defensive "anti" item for 10 fights. Effects: stat
cuts (5–15%), damage over time ignoring armour and block, Stunning/Dazing
(skipped actions), Sapping (heal), Marking, Forgetfulness, Crystallization.

**When live:** check whether Arena fights can use them, and look for new
fields in `attack` responses' `rounds`. `sampleFromAttack` and the
verification parser assume today's per-hit fields.

### Crimes: Mastery, Insight, circumstantials — Crimes Auto

- Mastery requirements cut to 75% (completed Mastery stays complete).
- Insight 1–5 per capstone: each level +5% base cash, XP and Favor (×1.25 at
  5) and +1 point item-loot chance; Insight 5 gives a permanent Instinct
  point per capstone.
- 50 circumstantial crimes, five per district, gated on district weather
  and total Instinct; cash and XP, no Mastery/Insight/Favor.

**When live:** watch Crimes Auto for parse-failure pauses on the new crime
entries and markup. Re-rank capstones: Insight may make some worth farming.

### Chemical Lab — Street Intel

Consumables restore 10/15/25 Nerve, Energy or Stamina, or +100% regen for an
hour. Stamina is Street Intel's limit, so these can raise its income. The
minimum card value suggestion measures Stamina actually spent per day, so it
adapts; re-check it after a few days of using them.

### Blood Cage — Street Intel Stamina

Entry costs 10 Stamina (competes with Street Intel). Points per minute
holding the Cage; daily prizes in testing 250 / 125 / 65 MG plus Platinum.
Replaces the district Forge tile (Forge stays in Inventory) — check any
feature that finds district tiles by position.
