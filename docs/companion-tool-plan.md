# Companion tool plan (draft)

Status: **planning, nothing built.** Started 2026-11-20. Name: **TFF
Consigliere** (decision 1).

A helper for other players — first the player's own family (guild), maybe more
later — built on what this extension has learned about the game. The extension
stays personal and private; it only *produces* game-rule data the tool uses. The
tool collects and runs on **its own** play data.

## Background

- The player wanted to play Street Intel on their phone, where the extension
  doesn't run. That produced the **Street Intel Guide**, a private Artifact page
  (https://claude.ai/artifact/5rFbtLggergJQw4iAoCm4y):
  - card odds before scouting, same formula as the extension's badges
    (`src/shared/streetIntelPredict.ts`) — checked identical on all 26,208
    card × condition × approach combinations;
  - a searchable condition picker (all 38 conditions, or type to narrow);
  - the complication Pick/Avoid table (913 resolved complications since
    2026-08-10, same rule as `src/shared/streetIntelComplications.ts`);
  - built by `verification/street-intel/build_mobile_guide.py` from the template
    `verification/street-intel/mobile_guide.html`, refreshed with the
    `/refresh-street-intel-guide` skill.
- The companion tool grows that idea for other players. The guide stays the
  player's own (it may keep exact counts; only they see it).

### What carries over to other players, and what doesn't

| Part | Whose | In the tool |
|---|---|---|
| Base odds, 240 cards | the game's wiki | yes |
| Condition effects (38 sentences) | game rules (learned from this player's scouts) | yes |
| Card approaches (stat, bonus, always-fails) | game rules | yes. 168 of 240 cards seen so far; no title's approaches changed in the 45 days to 2026-11-20 (they did vary before 2026-09-06) |
| Complication win/loss record | this player's play | **verdicts only** (Pick/Avoid), never counts — see [Data ownership](#data-ownership) |
| Card value (drops, cash) | this player's play | not in version 1 — didn't hold across levels (decision 15) |
| Stats and Street Intel bonuses | each player's own | entered by the member, saved to their account (synced across devices and the bot) |

How much a player's stats matter (measured on the guide's data, 6,552 card ×
condition cases): with no stats at all, the best odds drop 2.2 points on
average (6 max), the best approach changes in 5% of cases (near-ties) and a 50%
go/skip call flips in 0.4%. Stats 20 behind: 0.6 points average, no go/skip
flips. The approach bonus, the card's base odds and the Street Intel bonuses
(~74 shared points) matter far more.

## Features

**Decided 2026-11-20: version 1 is Street Intel only.**

**Design rule (decided 2026-11-20): no feature may require a check before every
action in the game.** Members won't switch to the tool before each attempt or
each complication. Every feature has to work as one of:
- **learn once** — read it a few times and carry it in your head;
- **occasional lookup** — worth opening only for the decisions that matter, and
  fast when you do (a few seconds, remembers recent cards);
- **optional contribution** — nice if members do it, never needed for the tool to
  be useful.

How each feature fits the rule:

1. **The Avoid list (complications) — learn once.** There are only 24
   complication scenarios, and 18 of them have one choice that has never won in
   the player's history (2026-11-20 data: e.g. "Your getaway driver never showed
   up" — never Fight; "You hear footsteps behind the door" — never Talk). A
   single compact page — scenario, Pick, Avoid — that members can read a few
   times, screenshot, and soon know by heart. Searchable for the rare one they
   forget. This is the most useful feature and needs no habit change.
2. **Card odds — occasional lookup, instead of a scout.** The value isn't
   "check before every attempt"; it's "check instead of spending Stamina on a
   scout" for a card that matters: a big reward, an unfamiliar card, a condition
   they're unsure of. The biggest factor — each approach's hidden bonus (+25,
   −10, always fails) — isn't shown in the game at all, which is what the tool
   adds. Fast path: type 2–3 letters, tap the condition, done; recent cards on
   top; bonuses calibrated once per card type (see
   [Calibrating a member's bonuses](#calibrating-a-members-bonuses-tested-2026-11-20)).
3. ~~Card value — a label inside card odds~~ — **left out of version 1**
   (tested 2026-11-20, see [Card value check](#card-value-check-2026-11-20)):
   per-card labels from the player's drops were no better than chance, and the
   ranking of risk tiers flipped as the player levelled up.
4. **Logging results — optional, but a first-class, effortless flow** (the
   player's priority, 2026-11-20). Optional means the tool never *depends* on
   it — not that it's tucked away. Logging must be so easy that doing it is the
   path of least resistance. Members won't return after every complication, so
   the tool never depends on it: the seeded Avoid list is
   useful with zero family logs. Logging is made as cheap as possible — two taps
   from the Avoid list, a "log a few at once" view for catching up later, and a
   `/comp` command in the Discord bot — and family data only takes over
   a scenario once there's enough of it. Expect a few members to do most of it.

Constraint: the tool can't see the game (no login, no reading anyone's board or
actions — only the extension can). Every feature is one of:
- **reference** — how the game works;
- **calculator** — the member enters their own numbers;
- **insight** — learned from play data.
Automation and live tracking stay in the personal extension.

Other areas considered (2026-11-20) and judged not useful enough for now, kept
for reference:

| Area | Feature | Kind | Readiness |
|---|---|---|---|
| Forge | item stats at each enhancement level, odds per step | calculator | rules measured (`forge-mechanics.md`) |
| Careers | rank thresholds, perks, caps, time to a goal | calculator | built for the player (Career Advisor) |
| Pets | how training points work; stat-points planner | reference + calculator | written up (`pet-training.md`), planner built |
| Smuggling | profit per route/market; VIP's real value | insight | measured from the player's deliveries |
| Gold Run | attack gold rules (350/day cap, recon >= 60 never lost) | reference | measured |
| Street Racing | leaderboard speed formula, weather schedule | reference | written up (`street-racing-leaderboard.md`) |
| Arena | win prediction from the opponent's card | calculator | not ready — post-patch review on hold |
| Casino | which games lose money on average | reference | measured, short |
| Stock market, automations, trade tracking | — | — | not suitable (live data or automation) |

A cheat sheet of these findings was considered and dropped (2026-11-20). Any
future area gets its own pack and tables (see [Naming](#database-draft)) and a
tab on the page.

## Principles

1. **One source of truth.** Data *and* rules exist once. The web page, a later
   Discord bot and anything else read from the same place — no front end keeps
   its own copy. Same discipline as the extension, whose badges and auto-runner
   share one predictor.
2. **The extension is the producer of game-rule data.** It holds the archive
   access and the original code, so it builds the packs. The tool never reads
   the player's archive or account.
3. **The tool runs on its own play data.** The player's history only seeds
   verdicts; every number shown comes from what members log. See
   [Data ownership](#data-ownership).
4. **Nothing personal leaves the player's account.** No stats, bonuses, cash,
   bank, history or counts.
5. **Access-controlled.** Only allowed users can open the tool or fetch its data.
   (Content can still be screenshotted; access control stops strangers opening
   it, not members sharing what they see.)
6. **Code and data kept apart.** The tool's code holds no game data and no
   secrets, so the repository could be made public later by flipping it, with
   nothing to scrub from its history. Data lives in the database; secrets (the
   Discord app secret, database connection, bot key) live in Vercel's
   environment settings.
7. **Small and cheap to run.** Free tiers, as little code as possible.

## Data ownership

Decided 2026-11-20.

**Why:** the player's complication counts (913 in ~3½ months, mostly automated)
would show how much they play, hint at automation and show recent activity
between refreshes. Members need the verdict, not the counts.

**How:**
- The pack carries **only verdicts** from the player's data: per scenario, which
  choice to Pick and which to Avoid. No counts, percentages or sample sizes.
- Every number shown is **the tool's own**: "Family record: Run 7/8 won",
  starting at zero and growing from members' logs.
- **Useful from day one:** at launch every known scenario already shows Pick
  and Avoid — the part members act on. The family record next to it starts
  empty ("no family results yet") and fills in as members log.
- **Switching a verdict to family data** (decided 2026-11-20): a scenario's
  verdict comes from the family's data, using the same rule as the extension
  (`describeComplicationChoices`), once the scenario has **at least 10 family
  results** and **every choice has at least 3**. A family "Avoid" also needs the
  extension's own bar: 0 wins in 2+ tries. Until then the seed verdict stands.
- **Disagreement is flagged, not flipped silently.** If the family's verdict
  differs from the seed, it shows on the admin page for the player to review.
  Early on, the player's data is far larger, so a disagreement is more likely bad
  logging than a real difference.
- Nothing from the player's archive is counted in the tool's tally, so the player
  can log their own manual results through the tool like anyone else without
  double counting.
- Card value was tested and left out of version 1 (decision 15).

## The fourth complication choice (found 2026-11-20)

The game's complication dialog (its own client code, in the archived board) has
**four** choices when `SI_V2` is on — and it is on: Fight Your Way Out
(Strength), **Stand Your Ground (Defence, `stand_ground`)**, Run For It
(Agility), Talk Your Way Out (Dexterity). The extension's complication data and
rule only know Fight, Run and Talk; Stand Your Ground was chosen just 13 times
in the whole archive (10 won), 1–2 per scenario — far too few for a verdict.

For the tool:
- The Avoid list shows all four choices; Stand Your Ground shows "not enough
  data yet" and is never marked Pick or Avoid from the seed.
- Logging includes it, so the family's own data is how it gets a verdict. Its
  pooled prior for the Pick rule (the extension has none) is to be set from the
  family data, or the average of the other three until then.
- The dialog code has no timer: it waits for a tap, so switching to the tool
  mid-complication is safe as far as the page goes (whether the server expires
  an unanswered complication is not checked).

Separately, the extension's own complication hint and auto-runner ignore Stand
Your Ground — a gap in the extension, outside this plan.

## Logging UX

Members tell the tool whether the choice they made won or lost. Optional (see
the design rule under [Features](#features)), but **a priority to get right**:
it has to cost almost nothing and be in plain sight — one-handed, no forms, no
confirmation dialogs, no page reloads, never more than two taps from opening
the tool.

Ways it's kept effortless:
- **On the Avoid list itself.** Every scenario row carries the log action, so
  the page members already read is also where they log.
- **One tap for the common case.** Most members will follow the advice, so each
  scenario has a single "Did the Pick → Won" button; anything else is two taps.
- **Home-screen shortcut.** The installed app offers "Log a complication" as a
  shortcut (long-press the icon), opening straight to the list.
- **Visible effect.** After logging, the family record updates at once
  ("Family: Run 8/9"), so members see their entry count.
- **Works offline** (decision 6): logs queue on the device and send later.

**Flow (the Avoid list):**
1. **Find the scenario.** The Avoid list shows all 24 on one page; search
   narrows it. From the card odds view, a "Got a complication?" link jumps
   straight here.
2. **See the advice.** The scenario shows its four choices (Fight / Stand
   Your Ground / Run / Talk, with the stat each uses), Pick and Avoid marks, and the family record
   per choice.
3. **Log in two taps.** Tap the choice you made → it expands in place into two
   large buttons, **Won** and **Lost** → tap one. Done. Tapped the wrong choice
   before picking Won/Lost? Tap another choice (or anywhere else) and nothing is
   logged.
4. **Instant feedback.** The family record updates immediately, and a toast says
   "Logged: Run · Won" with **Undo** and **Change** for 10 seconds.
5. **Undoing or changing any time.** A member can undo or correct any of their
   own entries whenever they notice — not only within the toast's 10 seconds:
   "My recent logs" lists their entries with **Change** (pick a different
   choice or flip Won/Lost) and **Remove** on each. Change shows an Undo toast;
   Remove asks first ("Remove this result?"), like every action that deletes
   or ends something (rule, 2026-11-20: sign out, delete my data, remove,
   revoke and reject always confirm; quick reversible actions use Undo).
6. **Catching up later.** "Log a few at once": the 24 scenarios as compact
   rows, each with the four choices and Won/Lost — for a member who played
   several and logs them afterwards.

**Details:**
- Buttons at least 44 px tall (the common touch-target minimum); Won and Lost are far enough apart not to mis-tap.
- A likely double tap — same member, scenario, choice and result within 60 s —
  isn't blocked; the toast says "Logged twice?" with Remove.
- Each result records which choice the tool suggested at that moment and where
  that verdict came from (seed or family), so the tool can measure whether its
  advice actually works.
- If offline use is chosen (decision 6), logs made offline queue on the device
  and send when the connection is back.
- Logging is a phase 1 feature on the page and in the bot (`/comp`), both
  writing to the same table — see [Discord bot](#discord-bot-planned-2026-11-20).

## Format: a web app

Members use web, phones, tablets, different browsers and the game's own app.

| Format | Phone | Tablet | Desktop | In-app players | Verdict |
|---|---|---|---|---|---|
| Browser extension | Firefox Android only | mostly no | yes | no | rejected |
| Native app | yes | yes | no | yes | rejected: stores, two codebases |
| **Web app** | yes | yes | yes | yes (alongside, split screen) | **chosen** |
| Discord bot | yes | yes | yes | yes | **built alongside**, as a second front end (same project) |

- Mobile-first, installable (PWA: "Add to Home Screen").
- Web page beats the bot for lookups: live search, the full condition list
  (Discord dropdowns cap at 25 options, there are 38 conditions), one-tap
  changes, richer results, remembered bonuses. The bot wins for quick actions
  inside Discord.

## Look and feel: native-feeling mobile app (decided 2026-11-20)

Mobile-first and installable (PWA), designed to feel like a phone app, **not a
website shrunk to fit**. Desktop and tablet get the same app laid out for the
extra space, not the other way round.

- **Installed, full screen:** opens from the home-screen icon with no browser
  bars; its own icon, name and launch screen on iPhone and Android; respects the
  notch and home-bar safe areas.
- **App navigation:** a bottom bar within thumb reach — **Home · My logs · Me** —
  that stays the same as modules are added; Home has one tile per module, and
  each module has its own sections (Street Intel: **Card odds | Complications**,
  as in the phone guide). Screens slide in and out; back works like the phone's
  back. Tablet and desktop turn the bar into a side bar. Details in
  [companion-tool-build.md](./companion-tool-build.md#screens-phone-first).
- **Bottom sheets, not pop-ups:** choices like Won/Lost, a condition picker or a
  card's details rise from the bottom and can be swiped away.
- **Touch-first:** targets at least 44 px, no hover-only controls, no tiny text
  links; swipe on a log entry to change or remove it.
- **Feels instant:** the pack is on the device, so lookups need no loading;
  logging updates the screen at once and syncs behind the scenes; skeleton
  placeholders instead of spinners where something does load.
- **System type and controls:** the phone's own font (San Francisco / Roboto),
  native inputs and number pads, light and dark following the phone's setting.
- **Small touches:** a short vibration on logging where the phone supports it
  (Android; iPhone browsers don't allow it), no pull-to-refresh bounce where it
  would fight the app's own scrolling.
- **Unofficial note** (decision 1) on the sign-in screen and in "Me", not on
  every screen.

## Access

Requirement: **strictly family members** (for now). **Decided 2026-11-20:
anyone in the family's Discord server** — everyone in the server is in the
in-game family, so no role rule.

| Option | How | Verdict |
|---|---|---|
| A. Discord bot as the tool | only server members can use it | needs server admin to add the bot (player isn't admin yet, could become one) |
| **B. Web page + "Sign in with Discord"** | page lets in only members of the family's server | **chosen**: full page UX, no admin needed |
| C. Claude Artifact shared per person | Share menu, one at a time | unconfirmed whether viewers need Claude access; awkward to manage |
| D. Shared password | anyone with it | rejected: passwords spread |

Details:
- Provider: Discord OAuth, via an existing library, session in a signed cookie.
- Discord app registered under the player's own Discord account (they own it).
- Needs: the server ID.
- Membership check: ask Discord only about the member's membership in **this
  one server** (the member-info-for-a-server permission), not for the list of
  every server they're in. Reveals less, and allows a role rule later without
  asking members for a new permission. The check's result isn't stored; the
  member's sign-in identity is (see below).
- The access check lives in the **service**, not the page, so data can't leave
  by an unchecked route. The bot authenticates to the service with a
  secret key; Discord already limits the bot to server members.

### Other sign-in methods later (decided 2026-11-20)

Discord only at launch, built so others (Google, email, …) can be added:
- **Who you are** and **who's allowed** are separate pieces. Discord answers
  both today (account + server membership). Another provider only answers the
  first, so its users prove they're allowed through an access request, the
  allowlist, or by linking their Discord account once.
- A sign-in library with many providers, so a new button is mostly
  configuration plus registering the app with that provider.
- People get the tool's own user id; sign-ins are linked identities
  (`users` + `user_identities`). Nothing is keyed on a Discord id, so one person
  can use Discord and Google and keep one history, and the bot finds the same
  person through their Discord identity.
- The session carries the tool's user id and access result, not provider details.

### Access requests and approval (decided 2026-11-20)

- **Family members: automatic.** A Discord sign-in from a member of the family
  server is approved immediately (`access_via = family_server`). It ends when
  they leave the server (checked at sign-in; see decision 7).
- **Everyone else: request access.** They give their in-game name and a short
  note, then see "waiting for approval". One open request per person; a cap on
  reapplying after a rejection.
- **Admin page** (the player, later moderators): pending requests with name,
  sign-in method, note, date; Approve / Reject; Revoke anyone later. Manual
  approvals (`access_via = approved`) last until revoked. The same page lists
  verdict disagreements (see [Data ownership](#data-ownership)).
- **Allowlist** = approving an account in advance (a Discord or Google account
  id); they get straight in at first sign-in.
- **Notification** of new requests: a direct message from the bot to admins,
  plus a badge on the admin page. Before the bot is installed: a Discord
  webhook posting to a private channel (needs "manage webhooks" on that
  channel — the player's own server works).
- Every decision is logged (`access_log`).
- Opening to non-family people sends the game data and the seeded verdicts
  beyond the family — ties to decision 2.

### In-game usernames (decided 2026-11-20)

Useful for moderation and seeing who uses the tool. The family doesn't set
Discord nicknames to in-game names, so the tool asks for it as a **setup to-do
on the main page** (see [First visit and setup](#first-visit-and-setup)),
editable later; access requests from outside the family ask for it up front. Self-reported: the tool can't
see the game to verify it.

## Discord bot (planned 2026-11-20)

Built together with the web app, in the same project, reading and writing the
same data through the same service. The web app works without it; the bot is
switched on once it's installed in the family server.

### How it runs (free, no always-on server)

- **Slash commands over HTTP:** Discord sends each command, button press,
  autocomplete or form to one endpoint in the Next.js app
  (`/api/discord/interactions`) on Vercel. No permanent connection to Discord,
  so nothing runs between uses and it stays on the free tier.
- **Limits of that model:** the bot can't read channel messages or react to
  events; it only answers commands and button presses. That's all we need.
- **Every request is verified** with Discord's signature (Ed25519) before
  anything runs.
- **3-second rule:** Discord needs a first answer within 3 seconds. A cold
  serverless start plus a database query can exceed that, so commands that
  touch the database reply "thinking…" at once and fill in the answer after
  (Discord's deferred response).
- **One Discord app** serves both "Sign in with Discord" and the bot.
- Commands are registered to the family server (and a private test server) by a
  script run on deploy; server commands update instantly.

### Who can use it

- Commands only work **inside the family server** (the interaction carries the
  server id; anything else is refused, and DMs are off). Everyone in the server
  is family, so being able to run the command is the access check.
- The bot links the Discord user to the same person as the web app through
  `user_identities` (provider `discord`). Someone who uses the bot before ever
  opening the web app gets a `users` row on first use (`access_via =
  family_server`), so their logs are theirs on both.
- Replies are **private to the person** (ephemeral) unless a command says
  otherwise, so channels aren't spammed and nobody sees others' lookups.

### Commands (version 1, Street Intel)

| Command | What it does |
|---|---|
| `/comp scenario:` | Scenario picked by autocomplete (all 24 fit Discord's 25-option limit). Replies with Pick / Avoid and the family record for all four choices, with log buttons: **Pick → Won** (one tap), or a choice then **Won / Lost**. The confirmation has **Undo** and **Change**. |
| `/avoid` | The whole Avoid list in one message — the learn-once page. Private by default; an option posts it to the channel so it can be pinned. |
| `/odds card: condition:` | Card and condition by autocomplete; replies with each approach's odds and the go/skip call, from the member's saved setup. If a card type isn't calibrated yet, it says so and shows the approach roles (+25, +10, −10, always fails) instead. |
| `/mylogs` | The member's recent logs with **Change** and **Remove** buttons. |
| `/consigliere` | Link to the web app and a one-line help. |

Autocomplete narrows as you type, so 38 conditions and 168+ cards work despite
Discord's 25-option menus.

### What the bot adds beyond commands

- **Admin notifications by direct message:** the bot can message admins
  directly (no permanent connection needed), replacing the separate webhook for
  new access requests and verdict disagreements.
- **Simpler membership checks:** with the bot in the server, the daily
  membership re-check (decision 7) can ask Discord with the bot's own key,
  instead of relying on each member's sign-in token staying valid (those
  expire and need refreshing). Sign-in keeps the one-server check either way,
  so the web app never depends on the bot.

### Installing it

Adding a bot to a server needs "Manage Server" there. The player isn't an admin
yet; until then the bot runs in a private test server, and the web app is the
family's way in. Permissions requested: only `applications.commands` (slash
commands) — no reading messages, no moderation rights.

## Architecture

```
  your archive ──(builder + checks, this repo, on your Mac)──┐
                                                             │ upload new pack version
                                                             ▼
                                              ┌──────────────────────────────┐
                                              │  Neon Postgres (the engine)  │
                                              │  · street_intel_packs        │
                                              │  · users, access             │
                                              │  · logged results            │
                                              └──────────────┬───────────────┘
                                                             │ server-side only
                                              ┌──────────────▼───────────────┐
                                              │  Service (Vercel)            │
                                              │  · access check (Discord)    │
                                              │  · serves the active pack    │
                                              │  · accepts logged results    │
                                              └───────┬──────────────┬───────┘
                                                      │              │
                                                 web page     Discord bot
```

- Page and bot hold no data of their own.
- Odds are computed on the page/bot with the pack's rules script and the
  member's own stats and calibrations, saved to their account so every device
  and the bot use the same setup.
- One repository for the tool (service, page, later bot), separate from this
  extension.

## The Street Intel pack

Each feature area has its own pack, stored in its own table and versioned on
its own (decided 2026-11-20). Version 1 has one: the **Street Intel pack**, a
versioned bundle, e.g. `2026-11-20`.

| Part | Contents | Built from |
|---|---|---|
| Cards | title, category, level, base odds, approaches (stat, bonus, always-fails) | `src/shared/data/streetIntelCatalog.json` + archived boards |
| Conditions | each sentence's effect | `src/shared/data/streetIntelConditions.json` |
| Complication verdicts | per scenario: Pick and Avoid choices only, **no counts** | archive (pairing as `build_complication_seed.py`, rule as `describeComplicationChoices`) |
| Rules | odds formula + Pick/Avoid rule as one small script | compiled from the extension's own TS (`streetIntelPredict.ts`, `streetIntelComplications.ts`) |

Never in the pack: stats, bonuses, cash, bank, history, or counts of any kind
from the player's account.

Delivery: a skill (like `/refresh-street-intel-guide`) builds the pack, checks
the rules script against the extension's predictor (expect 0 differences),
then uploads it to the database as a new version. See [Packs in
Neon](#packs-in-neon-decided-2026-11-20).

## Service requests (draft)

All need a signed-in allowed user, or the bot's secret key.

| Request | Answers | Used by | Phase |
|---|---|---|---|
| Current pack version | e.g. `2026-11-20` | page, bot | 1 |
| The pack | whole pack (a few hundred KB) | page, bot | 1 |
| Family record | per scenario and choice: family wins/tries, current verdict and its source | page, bot | 1 |
| Log a result | scenario, choice, won/lost (+ suggested choice, verdict source) | page, bot | 1 (bot: 2+) |
| Undo / change / remove my result | the toast's Undo or Change, or "My recent logs" — own entries only, any time | page | 1 |
| Admin: requests, decisions, verdict disagreements, moderation | — | page (admins) | 1 |

## Storage

| Data | Where |
|---|---|
| Game data | one pack per feature, stored in **Neon** (`street_intel_packs` for version 1), served by the service only after the access check |
| A member's stats and calibrations | their account, in Neon (`member_setup`); also cached on the device for offline use |
| Who's signed in | `users` + `user_identities` (a row per member, written at first sign-in); session in a signed cookie |
| Logged results | `street_intel_complication_results` in Neon |

### Hosting: Vercel (decided 2026-11-20)

Page, sign-in functions and service on Vercel. Code changes deploy from the
tool's repository; pack refreshes don't need a deploy (see below).

### Packs in Neon (decided 2026-11-20)

Replaces an earlier decision the same day to commit the pack to the tool's
repository. Reason: if the code were ever open-sourced, the pack — and every
past version in git history — would become public with it, bypassing the
access control. Keeping data out of the code repo from day one means
open-sourcing later is just making the repo public.

How it works:
1. A skill in this (extension) repo rebuilds the pack from the archives.
2. It checks the rules script against the extension's predictor (0 differences
   expected).
3. It uploads the pack to Neon as a new row in `street_intel_packs` and marks it
   active. No deploy.
4. The service reads the active pack server-side and hands it out only after
   the access check.

Undo: mark the previous version active. History: every version stays in the
table, so packs can be compared.

### Database: Neon Postgres (decided 2026-11-20, used from phase 1)

The engine: holds packs, users and access, and logged results. Neon:
- Postgres fits the data — versioned packs as rows; results as rows; the
  family record is a grouped count; "remove one member's entries" or "since the
  last patch" are plain queries;
- scales to zero when idle, so a bursty family tool costs little or nothing —
  check the free tier's current limits before setting it up;
- connects to Vercel through the Marketplace (environment variables set
  automatically);
- manageable directly from Claude Code (a Neon connection is configured).

Not chosen: Supabase (also Postgres, but its main extra is its own sign-in;
Discord handles that), a key-value store like Upstash Redis (fine for counters,
awkward for removing one member's entries or time-based queries).

## Data the tool can and can't collect

- **Complication outcomes:** fully visible to players → logged in the tool
  (page from phase 1, bot later).
- **A new card's approaches:** the dialog shows "USES STRENGTH", but the
  approach **bonus** and **always-fails** flag are hidden in the page code — a
  member can't log them by hand. Known cards come from the player's archive via
  the pack; unknown ones can be worked out from members' scouts — see [Cards the
  pack doesn't know](#cards-the-pack-doesnt-know-2026-11-20).
- **Condition effects:** need scouts; from the pack.
- **Drops per attempt:** visible, but logging them every attempt is likely too
  much work (decision 15).
- Not planned: distributing this extension for data exports — it stays personal.

## Database draft

Planned now so implementation doesn't reopen it. Postgres on Neon.

**Naming (decided 2026-11-20):** feature tables are named for the feature they
serve, `street_intel_*`, never generic names like `data_packs` that a later
feature would also want. A future area gets its own tables (e.g. `forge_packs`),
so its data refreshes and rolls back independently. Each pack's contents stay
one `jsonb` block per version rather than split into tables: the page always
loads the whole pack, and one row per version means a switch can never mix old
cards with new conditions.

**`street_intel_packs`** — one row per Street Intel pack version.

| Column | Type | Notes |
|---|---|---|
| `version` | text, primary key | e.g. `2026-11-20`; a second build the same day gets a suffix (`2026-11-20.2`) |
| `created_at` | timestamptz, default now() | |
| `data_until` | timestamptz | newest archive row the pack was built from |
| `pack` | jsonb | cards, conditions, complication verdicts |
| `rules` | text | the compiled rules script |
| `summary` | jsonb | the builder's counts (cards known, …) for comparing versions — admin only, never served to members |
| `is_active` | boolean, default false | exactly one active: a partial unique index on `(is_active) where is_active` |

Switching the active pack (new upload or undo) happens in one transaction, so
the service never sees zero or two active packs.

**`users`** — one row per person.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, primary key | the tool's own id; everything else points here |
| `created_at` | timestamptz, default now() | |
| `last_seen_at` | timestamptz | last sign-in, for spotting people who left |
| `display_name` | text | Discord username from the latest sign-in — the only way to tell applicants apart on the admin page |
| `game_name` | text, null | in-game username (decision 16) |
| `game_name_source` | text, null | `self_reported` for now; `discord_nickname` kept for later — the tool can't verify it in the game |
| `access_status` | text | `pending`, `approved`, `rejected`, `revoked` |
| `access_via` | text, null | `family_server` (ends on leaving the server) or `approved` (lasts until revoked) |
| `request_note` | text, null | what the applicant wrote |
| `is_admin` | boolean, default false | can see the admin page, decide requests, moderate |

**`user_identities`** — the sign-ins linked to a person.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid → `users.id` | |
| `provider` | text | `discord` now; `google` etc. later |
| `provider_account_id` | text | e.g. the Discord user id |
| `created_at` | timestamptz, default now() | |

Unique on `(provider, provider_account_id)`.

**`access_log`** — every access decision.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint, identity | |
| `user_id` | uuid → `users.id` | whose access changed |
| `action` | text | `requested`, `approved`, `rejected`, `revoked`, `auto_approved`, `auto_ended` |
| `by_user_id` | uuid → `users.id`, null | who decided; null for automatic |
| `at` | timestamptz, default now() | |
| `note` | text, null | |

**`access_allowlist`** — accounts approved before they sign in.

| Column | Type | Notes |
|---|---|---|
| `provider` | text | `discord`, `google`, … |
| `provider_account_id` | text | |
| `added_by` | uuid → `users.id` | |
| `added_at` | timestamptz, default now() | |

**`member_setup`** — a member's own numbers for odds (one row per member).

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid → `users.id`, primary key | |
| `strength`, `defence`, `agility`, `dexterity` | int, null | as the member entered them |
| `stats_updated_at` | timestamptz, null | so the page can suggest updating old stats |
| `calibrations` | jsonb | per card type: the worked-out bonus window, the scout(s) it came from, when |
| `updated_at` | timestamptz | the latest change wins when two devices edit offline |

Never shown on admin pages; deleted with the member's data.

**`street_intel_complication_results`** — one logged complication outcome.

| Column | Type | Notes |
|---|---|---|
| `id` | bigint, identity | |
| `created_at` | timestamptz, default now() | |
| `user_id` | uuid → `users.id` | who logged it |
| `scenario` | text | normalised like `normalizeScenario` (curly → straight apostrophe, collapsed spaces) |
| `choice` | text, check in (fight, stand_ground, run, talk) | the game's own `choice=` values |
| `won` | boolean | |
| `suggested_choice` | text, null | the Pick shown when logged (null if none) — measures whether advice works |
| `verdict_source` | text, null | `seed` or `family` — where that Pick came from |
| `pack_version` | text | Street Intel pack in use when logged — ties entries to a game-data era |
| `source` | text, check in (bot, page) | |
| `removed_at` | timestamptz, null | soft delete: removed entries stop counting but stay auditable |
| `removed_by` | uuid → `users.id`, null | the member themselves or a moderator |
| `removed_reason` | text, null | `undone`, `changed` (a corrected row replaces it — see `replaces_id`), `removed`, `moderated` |
| `replaces_id` | bigint → this table, null | on a corrected row: the entry it replaced |

Indexes: `(scenario)` where `removed_at is null` (the family record);
`(user_id, created_at)` (a member's recent logs, rate limiting, double-tap check).
Undo, change and remove never delete rows: a change marks the old row
`changed` and adds a corrected one pointing back to it, so the family record
always counts the latest version and moderators can see the history.

**The family record** = `count(*)` grouped by scenario, choice, won from rows
where `removed_at is null`. Nothing from the player's archive is ever counted.

**Moderators** — admins (`users.is_admin`). The first admin (the player) is
bootstrapped from a Discord user id in an environment variable, matched through
`user_identities` at their first sign-in.

**Rate limit** (decided 2026-11-20) — at most 20 logged results per member per
hour. Street Intel cooldowns allow roughly a dozen attempts an hour at most, and
only some bring a complication, so 20 never blocks real play but stops spam.

**`street_intel_card_reports`** — what members learned about a card the pack
doesn't know (nice to have, 2026-11-20).

| Column | Type | Notes |
|---|---|---|
| `id` | bigint, identity | |
| `created_at` | timestamptz, default now() | |
| `user_id` | uuid → `users.id`, null | null after a member deletes their data |
| `card_title` | text | as shown on the board |
| `approach_key` | text | the game's approach key (from the dialog's choice) |
| `approach_label` | text | as shown |
| `stat` | text | as shown ("Uses Strength") |
| `role` | text | worked out: `+25`, `+10`, `-10`, `always_fails` |
| `shown_pct` | int | the odds the game showed |
| `status` | text | `pending`, `accepted`, `rejected` |

A card is accepted when two members agree on its roles, or an admin approves it;
accepted cards go into the next pack.

## Phases

| Phase | What | Needs |
|---|---|---|
| 1 | Web page: card odds, the Avoid list with logging + family record; setup to-dos; Discord sign-in, access requests, admin page; service + Neon; nightly backup; the pack refresh skill + a CLAUDE.md reminder to offer it after archive merges. **Discord bot built in the same project** (commands, logging, admin notifications), tested on a private test server | Discord app (one app serves both sign-in and the bot), Vercel account, Neon database, GitHub account, server ID |
| 1b | Bot installed in the family server | someone with "Manage Server" there (the player once admin, or an admin doing the install) |
| 1+ (nice to have) | Data rights page + delete my data; unknown-card reports (also as a bot command) | — |

## Open decisions

Decided items are kept, struck through, so the reasoning isn't lost.

1. ~~Name~~ — **decided 2026-11-20: TFF Consigliere.** Plain "Consigliere" was
   too generic; "TFF" ties it to the game. Because the game's initials are in
   the name, the page header, the Discord bot's profile and the sign-in screen
   say **"Unofficial — made by a player, not by The Fifth Family"**, so nobody
   takes it for a game product (more important if it's ever monetised).
2. **Audience beyond the family.** The access check is one swappable piece in
   the service, and access requests let non-family people in one by one. Opening
   it wider sends game data and seeded verdicts beyond the family.
3. **Monetisation** (e.g. a Buy Me a Coffee link) — **later, only once the tool
   reaches beyond the family.** Before adding one, check:
   - the game's terms on third-party tools, and on earning from them;
   - Vercel's terms: the free (Hobby) plan is for non-commercial use — check
     whether donations count, or plan for a paid plan;
   - whether reusing the game's wiki data in something that earns money is OK.
4. ~~Sharing the player's complication counts~~ — **decided: no.** Only verdicts
   from the player's data; the tool shows and runs on its own logged data. See
   [Data ownership](#data-ownership).
5. ~~Cheat sheet~~ — **dropped**: those topics judged not useful enough.
6. ~~Offline use~~ — **decided: yes.** The pack is cached on the device and
   logs made offline queue and send later. To limit what someone who leaves
   keeps using, a cached pack stops working after 7 days without a successful
   online check.
7. ~~Leaving the server~~ — **decided: re-check membership daily** (the first
   time the tool is opened online each day), not only at sign-in.
8. ~~Access rule~~ — **decided: anyone in the family's Discord server.**
9. ~~Host~~ — **decided: Vercel.**
10. ~~Telling the family's leaders first~~ — **decided: yes**, leadership sees
    it before it's posted in the family's Discord.
11. ~~Who refreshes the pack and when~~ — **decided: the player, through a
    skill**, after downloading an export, whenever the game adds cards or
    changes something (not on a schedule). Like the phone guide's refresh, but
    it never includes the player's stats or bonuses. The skill and a CLAUDE.md
    reminder are built in phase 1, once there is a pack builder and a database
    to run against (see [Phases](#phases)).
12. ~~Where the packs live~~ — **decided: in Neon** (replaced "in the tool's
    repository" — see [Packs in Neon](#packs-in-neon-decided-2026-11-20)).
13. ~~Database~~ — **decided: Neon Postgres, from phase 1.**
14. ~~Database and logging details~~ — **decided** (left to Claude, by common
    practice): verdict switches at 10 family results with 3+ per choice; keep
    `display_name` (needed to tell applicants apart); 20 logs per member per hour.
15. ~~Card value labels~~ — **left out of version 1** (tested 2026-11-20): the
    labels didn't hold. See [Card value check](#card-value-check-2026-11-20).
16. ~~In-game usernames~~ — **decided: a setup to-do on the main page**
    (nicknames aren't set to in-game names).
18. ~~Web address~~ — **decided: a free `*.vercel.app` subdomain.** Everything
    stays on free tiers; no money is spent unless the tool starts earning.
19. ~~Game rules on helper tools~~ — **checked by the player: the game has no
    rule for or against them.**
20. ~~Tech stack~~ — **decided: Next.js, Better Auth (self-hosted in the app,
    data in Neon), Drizzle, Serwist, GitHub Actions backups.** Neon Auth
    considered and set aside for now — see [Tech stack](#tech-stack-decided-2026-11-20).
21. ~~Where a member's stats and calibrations live~~ — **decided 2026-11-20:
    saved to their account**, not kept on one device. Device-only was a
    leftover from the phone guide, which had no server; with accounts it meant
    entering stats separately on phone and web, losing them when browser data
    is cleared, and a bot that couldn't show personal odds. They're game numbers,
    not sensitive data. Listed on the "what we store" page and removed by
    "delete my data"; never shown on admin pages.
17. ~~Sign-in identity rows~~ — **decided: yes**, a small row per member from
    first sign-in (Discord account id, Discord username, in-game name, last
    visit) in `users` + `user_identities`.

## First visit and setup

**Decided 2026-11-20: setup is a to-do list on the main page, never a gate.**
After sign-in a member lands straight on the tool. Anything not yet filled in
shows as a to-do card on the main page, each saying why it's worth doing, and
the card disappears once done:

| To-do | Why (shown to the member) | Without it |
|---|---|---|
| Your in-game name | "So moderators and the family know who's logging." | works; the admin page shows their Discord name |
| Your stats (Strength, Defence, Agility, Dexterity) | "Makes your odds exact; without them they can be a couple of points low." | odds shown, marked approximate |
| Calibrate each card type (one scout per type) | "Your odds depend on bonuses the game never shows. One scout lets us work them out." | that card type's odds can't be shown; the odds view offers "Calibrate with this scout" right there |

Exception: someone **requesting** access (not in the family server) gives their
in-game name in the request, since the admin needs it to decide.

## Members' data rights (nice to have, 2026-11-20)

- A short "what we store and why" page: Discord id and username, in-game name,
  last visit, stats and calibrations (so they work on every device and in
  Discord), logged results.
- A "delete my data" button: removes the member's account, identities, stats
  and calibrations; their
  logged results stay as anonymous counts (the user link is cleared), so the
  family record doesn't shrink.

## Cards the pack doesn't know (2026-11-20)

The pack knows the approaches of 168 of the 240 cards — those that have been on
the player's board. Higher-level members will see cards the player hasn't
reached yet, and the tool should still help them (and let them build that data
before the player gets there).

What makes this possible (checked against every card on the player's boards in
the newer half of the archive, 13,924 cards): **every card has the same four
approach bonuses — one +25, one +10, one −10 and one that always fails.** Base
odds for all 240 titles come from the wiki. So for an unknown card, the only
unknown is *which approach has which role*.

How members fill it in:
1. The odds view says "This card isn't known yet" instead of guessing.
2. A member who scouts it enters what the game showed (approach and odds), as
   for calibration. With their calibrated bonuses, each revealed approach's
   bonus is worked out exactly: the four roles are 15+ points apart, while
   calibration is accurate to about a point.
3. Once every approach's role is known (one or two scouts, depending on how many
   approaches a scout reveals), the card becomes known for everyone. Until
   then, partial knowledge is shown ("Run is the +25 approach; others unknown").
4. Reports are kept per member (`street_intel_card_reports`) and a card is
   accepted when two members agree, or an admin approves it. Accepted cards go
   into the next pack.

**Tested end to end (2026-11-20)** on every scout with the current layout
(10,424; `verification/street-intel/companion/verify_unknown_cards.py`): each
scout was treated as an unknown card, with the bonuses
calibrated from a *different* card of the same type scouted in the previous 6
hours.
- Revealed approaches: **87.1% worked out to exactly one role, 12.7% narrowed
  to two (the right one among them), 0 wrong**, 19 of 10,599 (0.2%) fit no role
  (flagged rather than guessed).
- An always-fails approach always shows **0%** when revealed (3,248 of 3,248),
  so it's recognised outright.
- A scout reveals 1 approach (8,295 scouts) or 2 (2,129) for this player, so a
  card needs several scouts: most cards had all four roles after **2–6 scouts**
  (median about 4), counting every scout of that card. Pooling every member's
  scouts makes that quick. The rule "each role appears once per card" settles
  most two-way cases once other approaches are known.

Caveat: earlier boards (before 2026-09-06) had other bonus values (5–16), so if
the game changes the layout again this check must be re-run.

## Card value check (2026-11-20)

Question: can "Worth it / OK / Skip" labels from the player's drop history be
trusted by other players? Data: all 4,906 attempts 2026-08-10 → 11-20 (player
levels 55–147), drops valued as `analyze_drops_by_card.py` does, joined to card
titles; `verification/street-intel/companion/verify_card_value.py`.

- **Labels per card were noise.** Splitting recent play (levels 130–147) into
  two halves in time, the 28 cards with 10+ tries in both halves ranked almost
  unrelated (rank correlation 0.11), and only 9 of 28 landed in the same
  Worth it / OK / Skip third both times — exactly what chance gives (9.3).
- **Value changes with level (or time — with one player they can't be
  separated).** Drop value per Stamina rose from ~$19–69k (levels 55–109) to
  ~$180–300k (levels 130+), and the best risk tier changed with it: extreme at
  levels 55–109, then low/extreme/high close at 110–129, then medium at 130+.
- Titles within a tier do differ by more than chance in gold-or-better drop
  rates, but that is likely mixed up with when (at what level) each title was
  played.

Decision: card value is **not in version 1**. Revisit only with data from
several players at different levels — e.g. if the tool ever collects drop
results, which members are unlikely to log by hand.

## Backups (checked 2026-11-20)

Neon's free plan (Neon docs, "History window"): **instant restore to any moment
in the last 6 hours** (capped at 1 GB of history), and **1 manual snapshot**;
scheduled snapshots aren't on the free plan. That covers "someone wiped the logs
an hour ago", not "we noticed a week later".

What actually needs backing up: the packs can be rebuilt from the archive, so
the irreplaceable data is **members' logged results, card reports and access
decisions**.

Plan (free): a nightly **GitHub Actions** job runs `pg_dump` of those tables
and stores the dump in a **private** repository (it contains members' Discord
ids). GitHub's free tier covers a small nightly job. Keep 30 days; test a
restore into a Neon branch once before launch.

## Tech stack (decided 2026-11-20)

All free and open source; costs stay at Vercel's and Neon's free tiers.

| Piece | Recommendation | Why | Alternatives |
|---|---|---|---|
| Framework | **Next.js** (React, TypeScript) | Vercel's own framework: pages and server functions in one project, nothing to wire up; React + TS like the extension's dashboard | Vite + React with Vercel Functions (lighter page, more wiring); SvelteKit (small and fast, but a new framework to learn) |
| Sign-in | **Better Auth, run in our own app** (self-hosted library, stored in our Neon database) | free, open source, Discord provider built in, lets us request the one-server permission and use the Discord token for the membership check, supports adding Google later and custom access rules. Auth.js (NextAuth) is now maintained by the Better Auth team, which recommends Better Auth for new projects | Neon Auth (see below); Auth.js (security fixes only now) |
| Database access | **Drizzle ORM** + Neon's serverless driver | typed queries, migrations as files, light on serverless | plain SQL with the Neon driver |
| Offline / installable | **Serwist** (service worker for Next.js) | caches the pack and queues logs offline; makes the site installable | hand-written service worker |
| Backups | GitHub Actions + `pg_dump` | free, see [Backups](#backups-checked-2026-11-20) | — |
| Discord bot | a Discord interactions endpoint in the same Next.js project | no always-on server; free on Vercel. See [Discord bot](#discord-bot-planned-2026-11-20) | a separate bot host |

**Why not Neon Auth** (checked 2026-11-20 against Neon's docs): Neon Auth *is*
Better Auth, managed by Neon ("Managed Better Auth"), and it supports Discord.
But for Discord it **requests only the `identify` and `email` scopes** ("so you
don't need to configure scopes" — Neon docs, *Set up OAuth*), it has a **fixed
plugin set** (the managed client takes no `plugins` option), and the docs don't
cover reading the provider's access token. The family-only rule needs the
one-server membership scope (`guilds.members.read`) and the token to call
Discord with, so managed Neon Auth can't do our access check. Running the same
Better Auth library ourselves keeps everything in the same Neon database at no
cost, with full control. Revisit Neon Auth if a Discord bot is ever added to the
family server: a bot can check membership by Discord id on its own, and then
plain `identify` sign-in would be enough.

## Calibrating a member's bonuses (tested 2026-11-20)

Card odds need each member's Street Intel bonuses (rank, prestige, collection,
recon, mastery). The game never shows them — after a scout it only shows the
final odds per revealed approach (checked in the game's own client code in the
archived board). So the tool works them back out: the member picks the scouted
card, its condition and the approach, and types the odds the game showed; with
their stats, the formula gives the one unknown (the shared bonus) to within a
small window.

Tested on every scout in the archive (8,698 usable, 2026-08-10 → 2026-11-01;
`verification/street-intel/companion/verify_calibration.py`):
- The formula with the true bonuses reproduces the game's shown odds 9,424 of
  9,425 times.
- One scout pins the shared bonus to a window of 2.9 points (median; 90% under
  5.0). The true value was inside the window in 6,425 of 6,425 cases.
- Predicting the same card type's scouts over the next 6 hours: calibrated from
  one scout, **97% within 1 point** of the game (76% exact); with the true
  bonuses, 97% within 1 (93% exact). Three scouts: 83% exact, 99% within 2.
- Bonuses drift as a player progresses. Over the next 24 hours: calibrated 93%
  within 1 point; true bonuses 94%. Other card types: 87–90% within 1 for both,
  because mastery differs by card type (it did on 54% of this player's scouts).

Consequences for the design:
- One scout is enough to start; odds are typically within a point.
- Mastery is per card type, so calibrate once **per card type** (five types);
  until a type is calibrated, use the member's other types as an estimate and
  say so.
- Re-calibrating is just logging another scout; the tool keeps the latest per
  card type, and can combine recent ones to narrow the window.
- A scout during a short buff (4% of this player's scouts) calibrates too high.
  Buffs only ever raise the odds, so when two calibrations of the same type
  disagree, keep the lower and tell the member.
- The member's stats and calibrations are saved to their account (decision
  21), so calibrating on the phone also works on the web and in the bot.

Caveat: this history is one player in a fast-progressing period (Aug–Nov). A
player whose bonuses change slowly drifts less.

## Unverified

- **Whether complication outcomes are the same for every player**, not just this
  account. Family logs will show it: verdict disagreements on the admin page.
- **Artifact sharing** — whether members without Claude can open a shared link
  (no longer needed for this plan).

## Ownership and cost

The player owns the Discord app, Vercel and Neon accounts, and the code. Free
tiers should cover a family. If maintenance stops, the tool keeps working until
game changes make the data wrong.
