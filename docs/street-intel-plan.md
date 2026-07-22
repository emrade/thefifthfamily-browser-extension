# Street Intel Assistant — Browser Extension Plan

A candidate second feature for **The Fifth Family Enhancements**, following Trade
Assistant (the first feature — see `docs/trade-assistant-plan.md`). This is an early,
lightweight capture of an idea and what we know so far — not a committed plan or
scheduled work yet. Treat it the way `docs/trade-assistant-plan.md` looked after its
very first capture: a starting point to refine once we're ready to focus on it.

**Idea:** analyze the "Active Opportunities" on the Street Intel page and highlight
the one with the best reward, so the player doesn't have to eyeball every card. More
analysis (expected value using scouted odds, risk-adjusted ranking, etc.) planned as a
follow-up once this basic version is useful.

A separate game system from smuggling/trading — a crime/heist mini-game: pick an
"opportunity" card, optionally scout it (reveals success odds per approach), choose an
approach, resolve the attempt (success/critical success/failure), sometimes handle a
follow-up "complication." Has its own rank progression, contacts, and specializations.
Confirmed from one captured payload — treat everything below as a first look, not
verified across multiple sessions the way Trade Assistant's mechanics are.

### Confirmed technical details

- View: `GET /api/panel.php?type=street_intel` — same panel-JSON shape as everything
  else (`{"ok":true,"title":"Street Intel","html":"..."}`).
- Actions: `POST actions/street_intel.php` (own file, like smuggling/travel each have
  their own). Observed `action=` values from the page's inline script:
  - `scout` — params `opportunity_id`. Costs stamina (1 or 2 depending on the "The Rat"
    contact perk). Reveals per-approach success odds before committing.
  - `attempt` — params `opportunity_id`, `approach` (the chosen approach's `key`),
    `scouted` (bool). Returns outcome band (success/critical success/failure),
    `reward_cash`, `heat_added`, `xp_gained`, `intel_xp_gained`, possible `loot_drop`/
    `fragmentDrop`, possible `jail_time`/`hospital_time`, `cooldown_seconds`, and
    `has_complication` (if true, a follow-up is required).
  - `complication` — params `opportunity_id`, `choice` (`fight`/`run`/`talk`, each
    tied to a stat: strength/agility/dexterity). Resolves the complication with its
    own win/lose outcome (`cash_lost`, `extra_heat`, `jail_time`, `hospital_time`,
    possible loot).
- **Per-opportunity card data (what the "highlight the best reward" feature would
  read):** title, description, risk tier (`risk-low`/`risk-medium`/`risk-high`/
  `risk-extreme` class, sometimes `legendary`), reward range (e.g. `$400–$1,200`),
  heat range, stamina cost, level requirement, an expiry countdown
  (`data-seconds` on `.countdown`, same live-countdown pattern as the smuggling market
  timer), Intel XP range, an optional hidden "modifier" (flavor text hinting at a
  bonus/penalty, only revealed in detail post-scout via `modifier_intel`), and a list
  of approaches (`key`, `stat`, `bonus`, `label` — e.g. Strength/Dexterity/Agility
  options with different success-chance bonuses).
- **Player meta, also on this panel:** Intel Rank (0–6: Street Rat, Lookout, Scout,
  Informant, Operative, Spymaster, Ghost) with a flat `+N%` rank bonus, unlocked
  contacts (each a perk, e.g. "The Rat" cuts scout cost, "The Fence" adds loot chance
  on high/extreme risk), category specializations (Robbery / Interception / Extortion
  / Exploitation / Leverage, each with an operation count and a bonus % once a
  threshold is hit), and an "Operation Dossier" — a full history table (date,
  operation name, category, outcome, cash, intel XP, item drop) that's effectively a
  ready-made trade-history-style ledger for this system, same idea as Trade
  Assistant's own trade history.

### Notes for whenever this gets built

- The requested v1 slice ("highlight best reward") only needs the **unscouted** card
  data — reward range, risk tier, stamina cost, expiry — no need to auto-scout
  everything. A naive first pass could rank by displayed reward (e.g. range midpoint)
  per stamina spent; a real risk-adjusted/EV version needs scouted success odds per
  approach, which cost stamina to reveal and are a natural fast-follow, not v1 for this
  sub-feature.
- This is architecturally a second, independent feature next to Trade Assistant — own
  panel type, own action endpoint, own Dexie tables if we ever store history — so it
  should get its own entry in the popup's nav (per the Popup Information Architecture
  in `docs/trade-assistant-plan.md`), not live inside Trade Assistant's feature folder.
- Only one payload has been captured so far (no scouted-odds response, no
  attempt/complication response, no multi-session view to confirm reward ranges are
  stable) — needs the same kind of real-payload verification pass Trade Assistant went
  through before implementation starts.
