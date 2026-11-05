# Gold Run

Status: **implemented and run on the live game once** (5 fights, 2026-11-05). See "First live run".

Helps the player reach the daily gold cap from Fight Club attacks, to pay for vault
upgrades (Tier 25 costs 2,625 gold). Phase 1 is a panel where the player clicks each
fight. Phase 2 adds a run-to-cap automation on the same code.

---

## What the archive showed

1,425 fights from 2026-08-11 to 2026-11-05.

| Fact | Evidence |
|---|---|
| Cap is 350 gold per game day, reset at 23:00 UTC | Reached exactly 350 three times; `gold_today` restarts at 23:00:00 UTC on 08-12 |
| Each attack costs 5 stamina | `stamina_cost: 5` on all 1,881 recons |
| About 5.1 gold per fight at recon 60% or higher | 156 fights since Oct 25 |
| A day's cap takes about 68 fights, about 340 stamina | Nov 4: 66 fights, 330 stamina, 347 gold |
| All 14 losses came at `success_chance` of 55% or lower | 1,325 of 1,325 fights at 60% or higher were won |
| Worst damage at 60% or higher was 50% of max HP | Same fights; the maximum was 489 HP |
| Targets at 95% or more of own level pay about double | 9.6 gold and 210 XP against 4.7 and 24. Only 13 fights |
| About half the damage comes back after a win | `stats.vitality` is about `att_end_hp` plus half the damage |
| A target can be hit once per day | Player confirmed; the game removes them from the list |

### Request shape

- **Attack:** `POST /actions/attack.php` with `target_id` and `_csrf`. These are the only
  fields in all 1,448 attempts.
- **Recon:** `GET /actions/attack.php?type=recon&target_id=X`. One came before every
  fight, usually 1.3-2.2 s earlier on Nov 4-5 (fastest 1.08 s). The response has no token
  to forward.
- **Target list:** `GET /api/panel.php?type=attack_hub` with `fc_status`, `fc_levels`,
  `fc_fresh`, `fc_same_dist`, `fc_hide_fam`, `fc_sort`, `fc_seed`, `radar_page`,
  `pve_diff` and `_t`. 20 cards per page. Reuse the page's own values from
  `#fc-view-state` rather than building them. What `fc_seed` does is unknown.
- **Pace:** median 6.5-8.4 s between fights on Nov 4-5.

### Traps

- **A lost fight reports false counters:** `gold_today: 0` and `gold_cap: 200`. Update the
  gold counter from wins only.
- **Gold progress is not available before the first attack of the day.** It isn't in
  `stats.php` or the target list. Fights on another device won't be counted until the next
  fight here corrects the number.
- **Use `stats.vitality` for HP, not `att_end_hp`.**
- **Recon's `hospitalized` can be out of date.** 17 "Target is already hospitalized"
  errors came about 1-2 s after recon said false, all on Aug 16-17.

---

## Phase 1: panel (player clicks each fight)

Lives on the Fight Club page, behind its own page-feature toggle, off by default.

- **Progress:** gold today out of 350, stamina, HP, and fights left.
- **Stamina needed:** "about 340 stamina for the rest of today, you have 189, top up 151".
  Gold left divided by average gold per fight, times 5. Updated after every fight.
- **Target list:** every page of the current district's list merged (2-3 requests, loaded
  once on open and refreshed after fights). Offline targets only, highest level first.
- **Fight next:** recon the next target and show the verdict. At the cutoff or above,
  attack and show the result in the panel. Below it, skip and remember that for this run.
- **Prompts:** "Heal: HP below 50%" and "Out of targets here". No per-district target counts
  from earlier visits: players travel constantly, so those numbers go stale.

The panel never uses items and never travels. The player does both in the game as usual.

**Settings:** recon cutoff (default 60%), heal floor (default 50% of max HP).

---

## Phase 2: run to cap (automation)

Kill switch off by default. Only ever starts when the player presses Start.

Each step:

1. Stop if gold has reached 350.
2. Pause if stamina is under 5 or HP is under the floor.
3. Recon the next target, wait 1-2.5 s (randomised), then attack or skip.
4. Read gold, stamina and HP from the attack response, so there is no extra request.
5. Wait 5-10 s (randomised), and refresh the list as the game does.

### What it does in each situation

| Situation | Response |
|---|---|
| Gold reaches 350 | Stop and report the totals |
| Target below cutoff | Skip, remember for this run |
| "Target is already hospitalized" or "different district" | Skip. Pause after 3 in a row |
| Stamina under 5 | Pause: "top up N stamina, then press Resume" |
| HP under the floor | Pause: "heal, then press Resume" |
| Lost a fight, or hospitalized | Pause |
| Jailed or travelling | Pause |
| No targets left at the cutoff | Pause: "travel, then press Resume" |
| `SystemicActionError`, or any other response | Pause and show the message |

Nothing here retries or backs off. The player decides when it continues.

### Guards

- **One run at a time:** one `activeRun` guard covers Start, Resume and the Phase 1 button.
- **Stamina reserve:** while a run is active, including paused, and for 5 minutes after a
  by-hand fight from the panel, Street Intel Auto skips its cycle and reports why. Its Run
  Now button still works, as that's the player choosing. With nothing active, it behaves
  exactly as it does today. Street Racing isn't held back: it only runs when the player
  taps Run. Nothing else in the background spends Stamina.
- **Forgotten runs:** a run paused for 30 minutes ends, which releases the reserve.
- **New game day:** a run still going at the daily reset ends, so it doesn't spend Stamina
  on tomorrow's cap without being asked.
- **Background restart:** Firefox can unload the background script. Run state is kept in
  storage, and a run found after a restart is shown as paused, never continued on its own.
- **Automation queue:** a `gold-run` feature that takes the queue per fight with `linger`,
  because a whole run can pass the queue's 15-minute hold limit. With the queue on, other
  automations can wait for most of a run, up to the queue's own 15-minute limit.
- **Toggle state:** page UI listens to `chrome.storage.onChanged`, so a pause from the
  background shows up immediately.

### Code to reuse

- `src/background/gameAction.ts`: `postAction`, `fetchLiveStatus`. `LiveStatus` needs
  `vitality` and `maxVitality` added.
- `src/shared/fightClubRecon.ts`: `parseRecon`.
- `src/content/features/fightClub/index.ts`: `handleCapturedRequest` returns on anything but
  GET today. It must also read attack POSTs, so fights made in the game update the counter.
- `src/background/automationQueue.ts`: `runQueued`.

---

## How it was tested

Throwaway harnesses, not kept in the repo:

- **Parsers on real rows:** the list parser on all 163 list pages from Nov 4-5 (2,655 cards),
  the fight parser on 128 attack responses, the recon parser on 137 recons.
- **The real background code against a fake game** built from archived responses: 60 checks
  covering the cap, cutoff, loss, heal floor, Stamina, rejections, unrecognised responses,
  simultaneous triggers, the kill switch, Pause, travel, restart, the 30-minute limit, the
  day change and first use with no data.
- **The real panel in a simulated page:** 29 checks, including that a hostile player name
  stays plain text.

**Not tested:**

- Anything on the live game, including how the panel looks in Firefox.
- The Street Intel gate running inside its real cycle. Only the reserve logic it calls was
  run.
- A run with the Automation Queue switched on.

## Check on the first real fights

- Fights made by the extension have `origin: background`, so compare them in the archive
  with page fights: same outcomes and echoed fields. A missing field usually doesn't error.
- Does `success_chance` change with own HP or buffs? Not tested. It decides whether a skip
  should last, so Refresh forgets skips for now.
- What share of high-level targets pass 60%? 19 of 32 fought since Oct 25 were below it, and
  those were self-selected. Highest-level-first could mean long runs of recons with no attack
  in Diamond District, at 3-6 s apart, which isn't a pattern normal play produces (2 skipped
  recons in 138 on Nov 4-5).
- The 23:00 UTC reset hasn't been seen since the clocks changed in October. If it has moved,
  the counter reads wrong only until the next win.

## First live run (2026-11-05, 0.60.0)

Took gold from 319 to 350 in 5 wins and stopped at the cap. Response fields matched the 128
by-hand fights from Nov 4-5, and HP matched the half-back rule. Too short to show whether
Street Intel Auto holds off.

It sent 22 recons for 5 attacks, including 13 skips in a row at about one every 4 s, where
by-hand play skipped 2 in 138. Attacking nobody after opening target after target looks like
a script, so these were added:

- **Above your own level:** skipped with no recon. Nobody at 140+ reached 60% with the player
  at 137-138 (0 of 11).
- **Remembered odds:** each recon, including the game's own, is kept for 7 days. A target more
  than 5 points under the cutoff isn't reconned again. Odds moved 1.8 points on average
  between checks, none of the 8 under 55% later reached 60%, and 5 of the 21 at 55-59% did.
- **8 skips in a row pause a run,** as a backstop.
- **A 2-4 s wait after the opening list load.** The first recon had come 0.2 s after it.

On that run these would have left 7 skips, and about 4 on a repeat visit. Above-level targets
that might have passed are given up: they pay more, but so few pass that it isn't worth the
recons.

## Not included

- Using stamina or HP items.
- Travelling, and withdrawing the fare. Three taxi attempts failed on cash in two days, so a
  reminder to withdraw is worth having.
- Attacking online targets. Only 3 of 1,425 fights were against online players, so nothing
  is known about the risk.

## Decisions

- Recon one target at a time, right before each fight. Cutoff 60%, adjustable.
- The player uses all items. The panel says how much Stamina is needed, and a run pauses at
  50% HP (adjustable) for the player to heal.
- Crimes Auto keeps running during a run: it uses nerve, not Stamina. Jail would pause the
  run.
- No per-district target counts from earlier visits: players travel constantly.
