# Arena Auto-Attack

Status: **implemented.**

Fully automates the Arena page loop: opens a page once its timer allows, attacks every
regular opponent in win%-ascending order (riskiest first), attacks the boss if (and only if) its own
win% clears a player-set floor, banks the page, and schedules the next check for exactly
when the following page unlocks. A separate, always-on passive watcher notifies when a
page is ready regardless of whether automation itself is switched on — see "Notification
vs. automation" below. Built the same way every other automation in this extension is:
verified against real `arena_v2.php`/`panel.php` captures before any code was written.
See `docs/game-mechanics.md`'s own Arena section for the underlying combat mechanics
(randomness, `win_pct`, combat power) this automation relies on but doesn't itself
compute.

---

## What the archive showed

A full page cycle, captured end to end (2026-09-17), page 3:

```
open_next_page                                    → new_page {opponent_ids, opponent_bounties, boss_data}
attack opponent_id=1728 page_id=0  (44% shown)     → won/lost, points_earned, page_pot
attack opponent_id=5695 page_id=0  (48% shown)
attack opponent_id=2076 page_id=0  (51% shown)
attack opponent_id=754  page_id=0  (59% shown)
attack opponent_id=0    page_id=5338  ← the boss   → won:true, is_boss:true
bank page_number=3                                 → banked, season_score
```

Confirmed real, load-bearing for the design:

- **Every regular opponent's attack call sends `page_id=0`, always** — the client's own
  JS defaults it (`av2_arenaDoAttack(oppId, pageId)` called with only `oppId`, so
  `pageId || 0`). `opponent_id` alone is enough to identify a regular fight.
- **The boss is the one exception**, and its own real `page_id` (`5338` above) appears
  nowhere in any JSON response — not `open_next_page`, not any regular attack's own
  response. The *only* place it's ever been observed is rendered directly into the
  "ENGAGE BOSS" button's own `onclick="av2_arenaAttack(0,5338)"`, once unlocked — which
  only happens once all four regular opponents have been attacked (confirmed real
  disabled-state tooltip: *"Fight every opponent on this page to unlock the boss"*).
  So the boss's `page_id` has to be read from a live panel fetch taken after finishing
  the regular four; there's no way to know it any earlier. See
  `arenaPanelParser.ts`'s `parseBossEnginePageId` doc.
- **A loss zeroes the running page pot immediately**, confirmed from a real captured
  loss response (`page_pot: 0`) and the page's own warning text: *"Lose your next fight
  and the pot is gone."* Fighting continues afterward (this account's own real play
  attacked opponent 1728 — 44%, the riskiest of the four — *first*, not last, and still
  went on to fight the remaining three and the boss after it) — a loss resets the pot to
  zero, it doesn't end the page.
- **The boss never shows a win% badge in the UI**, but the server computes and returns
  one anyway, in `open_next_page`'s own `boss_data.win_pct` — confirmed real, `43` for
  the boss captured above. See `docs/game-mechanics.md` for why this means there's no
  prediction model to build here at all — the real number is just read directly.
- **The "Next Page Unlocks In" timer's `data-end`** is fixed the moment the *current*
  page opens (it's the *next* page's own unlock time), present in every panel load
  whether the current page is still being fought or already closed — not itself a
  signal for "is the current page done." "Ready to advance" is simply
  `data-end ≤ now`, independent of whatever state the current page's own opponents are
  in.

## Attack order

Ships attacking regular opponents in win%-**ascending** order — the riskiest fight
first. This is a correction (2026-09-17): the first version of this feature shipped
descending order (safest first) on the mistaken belief that it matched the player's own
described habit, despite the real page-3 capture directly above showing the opposite —
the account's own actual manual play attacked opponent 1728 (44%, the riskiest of the
four) *first*, not last. A real production run then hit exactly the failure this
predicts: three wins (55%, 53%, 49%) followed by a loss on the last, riskiest fight
(44%) wiped the entire accumulated pot, with no fight left afterward to rebuild it.

Given the "fight everyone regardless" rule (which is what shipped — see "Boss threshold"
below for the one exception), the running pot resets to zero on any loss but the page
keeps going — a loss is only permanent damage if nothing is fought after it, so the
pot's expected final value is order-sensitive. For two independent fights *X, Y* with
win% *p* and bounty *b*, attacking *X* first beats attacking *Y* first exactly when

```
b_Y · p_Y · (1 − p_X)  >  b_X · p_X · (1 − p_Y)
```

— equivalently, sort **ascending** by `b·p/(1−p)` and attack in that order. Win%-ascending
(what ships now) agrees with this EV-optimal order whenever bounty scales with risk in
the usual way (lower win% → higher bounty, which the real `opponent_bounties` tiers above
do), and can diverge only for a same-tier pair with unusual relative bounties — a gap
that doesn't matter in practice for this account's own data.

## Boss threshold

Attacks the boss only when `boss_data.win_pct` (see above) is at least
`ArenaAutoConfig.bossWinPctThreshold` — player-set, default 50 (the player's own choice:
*"50% ... Attack the boss only when you're a coin-flip or better to win"*), editable in
the popup's Arena Auto page and the in-page overlay alike. Below the floor, the boss is
skipped and the page banked without it — the same pot-preservation reasoning as
Street Intel Auto's own `minSuccessPct` floor.

A resumed page (see "Notification vs. automation" below) whose boss is already unlocked
skips the boss step entirely, rather than guessing at a win% that was never seen — the
number only exists in `open_next_page`'s own response, and a resumed page is by
definition one this run didn't call `open_next_page` for.

## Notification vs. automation

The player's own request: *"still include the notification in case i disable the auto
feature, i can still use the notification when i want."* Shipped as two genuinely
independent things sharing one alarm (`ALARM_NAMES.ARENA_AUTO`), branching on
`ArenaAutoConfig.enabled` at fire time:

- **`enabled: true`** — the full automate-and-bank cycle above, scheduling its next
  check for exactly the following page's own `unlocks_next_at`.
- **`enabled: false`** — a read-only panel fetch (never posts anything) that reschedules
  against the same timer if it's still running, or fires the `arenaPageUnlocked`
  notification and repeats every `ARENA_WATCH_REPEAT_MS` (15 min) for as long as a page
  sits ready and unopened — the same "no notify-once dedup, the repeat is the point"
  posture `streetIntel/index.ts`'s own opportunity poll already uses.

Deliberately **not** gated behind its own separate on/off switch the way
`CourierAutoConfig.watchEnabled` gates its own passive probe — that probe takes a real
action (a draft-then-cancel shipment). This one is a plain page read with no game-state
side effect, so it gets the same "no gameplay action, no kill switch" treatment
`stockMarket`'s price poller already has. `Auto-Attack` itself still defaults off, no
exception — every background/automated toggle in this codebase does.

## Resuming a page this run didn't open

`resolveOpenPage` (runner.ts) always re-derives "what's actually open right now" from a
live panel fetch rather than trusting any cached state — covering both the normal case
(this cycle just called `open_next_page` itself) and a genuinely real one: the player
manually started fighting a page before ever turning Auto-Attack on, or a prior cycle
was interrupted (service worker killed mid-page) before finishing it. Either way, the
live panel's own still-open opponent cards and win% are exactly as trustworthy as
whatever `open_next_page` would have returned — the one piece that's genuinely
unrecoverable in this path is the boss's win%, which only ever appears in
`open_next_page`'s own response (see "Boss threshold" above).

A page counts as "still needs finishing" — and is resumed rather than skipped past into
`open_next_page` — on any of three independent signals, not just one: a live unfought
opponent, an engageable boss, or (confirmed real, `parseIsPotActive`) the page's own pot
banner still reading `ar-pot-active` rather than `ar-pot-banked`. The third one is what
catches a page the player fully fought — including the boss — but never banked: no live
opponents and no engageable boss remain, so the first two checks alone would wrongly
conclude there's nothing left to do and open the next page with a real pot still sitting
unbanked on the one behind it.

## Known gaps

- **`bank`'s own implicit behavior toward a leftover pot on an old page is unconfirmed,
  but no longer reachable** — `resolveOpenPage` (see below) now refuses to call
  `open_next_page` at all while the current page's own pot banner still reads
  `ar-pot-active` (a real, unbanked pot), so this automation should never actually put
  that question to the test. What the game itself would do with a leftover pot if forced
  remains unconfirmed, it just isn't a path this code can trigger anymore.
- **`refresh` (re-rolling a page's opponents before combat begins) is unused** — real
  captures confirm it exists and costs Mafia Gold, but nothing the player described
  called for using it, so it isn't part of this automation's own decision-making.
- **`skip_timer`** (paying gold to end the countdown early) is likewise real and unused
  — the automation always waits out the real timer rather than spending gold to shorten
  it, since nothing in the request called for that trade-off to be made automatically.
