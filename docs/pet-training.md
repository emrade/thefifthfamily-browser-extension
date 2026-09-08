# Pet training — Feed/Train earn points, they don't spend them

Corrects a wrong assumption in [smuggling-v2-plan.md](./smuggling-v2-plan.md), which
read `feed_pet`/`train_pet`'s `"+10 points"`/`"+1 point"` messages as directly advancing
a pet's 0/10 capacity-milestone bar. Confirmed from
`fifth-family-archive-2026-09-06T14-27-10-157Z.ndjson.gz` (2026-09-02 → 2026-09-06,
16,102 requests) plus a live fix verified in-session on 2026-09-08: that's wrong, and the
archive shows exactly why one player's pet sat stuck for four straight days.

## The two-step mechanic

**Step 1 — earn Pet Points**, via `POST /actions/menagerie.php`:

| Action | Client call | Gain | Cooldown |
|---|---|---|---|
| Feed | `menFeed(petId)` | `+1 point` | Daily |
| Train | `menTrain(petId)` | `+10 points` | Weekly |

Response bodies confirm the point gain directly: `{"ok":true,"message":"Pet fed. +1 point."}`.
Neither call touches STR/DEF/AGI/DEX. Pet Points is a spendable balance, nothing more —
`window.menActivePet` on the Care tab reports it as `pet_points`, and a pet's roster row
shows it too (`"Legendary · 104% grown · 35 pts"`).

**Step 2 — spend the balance**, on the Menagerie → Care tab's "Spend Pet Points" panel
(`panel.php?type=menagerie&men_tab=care`, after `menSetActive(petId)` to bring that pet's
detail card to the top):

- Pick a stat: `menAllocPick('str'|'def'|'agi'|'dex')`
- Set an amount: `menAllocStep(±1)`
- Confirm: `menAllocConfirm(amount)`

**Cost is a flat 5 Pet Points per +1 to the chosen stat** — confirmed both from the
panel's own copy (`"Cost: 25 points → +5 AGI"`) and from `window.menActivePet.cost_per_stat: 5`.
"Stat Points Ready" (shown as its own tile) is just `floor(pet_points / 5)` — not a
separate currency, just how many whole allocations the current balance affords right now.

**It is only the *spent* STR+DEF+AGI+DEX total that the Smuggling panel's per-pet
milestone tracks.** That panel's note —

> `+N more STR/DEF/AGI/DEX (any mix) for the next milestone — then carries X at +Y% travel time.`

— counts allocated stat points since the pet's last milestone, not banked Pet Points and
not Feed/Train click count. Each pet has its own per-tier cost (not a flat +10); crossing
a tier raises capacity **and** lowers the travel-time penalty at once, taking effect on
the very next panel load with no extra action.

## What this looked like on a real account, stuck

Across all 132 `smug_tab=proto` captures in the archive's 4-day window, **every pet's
milestone note was byte-for-byte identical from first capture to last** — nothing moved,
despite 36 real `feed_pet` calls (3 rounds × 12 pets, all `"origin":"page"`, i.e. the
player clicking Feed themselves) landing across that same window.

George's case, read directly from his archive-window roster row and his frozen milestone
note:

| | Value |
|---|---|
| Capacity / travel (start of window, unchanged throughout) | 30 units, +160% |
| Milestone note (unchanged throughout) | "+6 more ... then carries 33 at +136%" |
| Pet Points balance, start of window | 35 (`⌊35/5⌋ = 7` stat points ready) |

He already had **7 stat points banked — more than the 6 his milestone needed** — the
entire four days. The daily Feed routine was real and working; the missing step was ever
opening "Spend Pet Points" and clicking Allocate.

## Confirmed fix, live

Two days after the archive export, George's Care tab (read live, not from archive) showed:

```
Total: 114 (110 base, +4 trained)
STR 26 (24 base +2 trained)   DEF 58 (56 base +2 trained)
AGI  4 (base only)            DEX 26 (base only)
Pet Points: 50 → Stat Points Ready: 10
```

Allocating **+6 AGI** (stepper to 6, cost 30 of the 50 banked points, confirm) crossed
the milestone immediately. Reported result: **George's capacity is now 33** — exactly
the number his stuck note had been predicting the whole time.

## Takeaway / how to check any pet

Feed and Train alone will never move a pet's smuggling capacity — they only fill a
balance that has to be manually cashed in. To check whether a pet is sitting on an
unspent milestone the way George was:

1. Smuggling panel → find the pet's card → read its `+N more STR/DEF/AGI/DEX` note.
2. Menagerie → Care tab → `Set Active` on that pet → read `Stat Points Ready`.
3. If Ready ≥ N, allocate N points (any mix of the four stats) and Allocate — the
   milestone clears on the next panel load. Anything left over banks toward the *next*
   tier rather than being wasted (inferred from the running "+N trained" tally being
   cumulative; not independently re-verified after a second crossing).

Given the daily Feed habit was already running for all 12 pets in the archive, the rest
of the roster (Wild Boar, Blue Crab, etc.) is likely sitting on the same kind of unspent,
ready-to-cash-in balance — worth checking each the same way rather than assuming only
George was affected.

## Still unconfirmed

- The actual `menAllocConfirm` backend action name/shape — never called in the captured
  archive window (only an unrelated `action=allocate&perk_id=...` for the Academy
  perk-tree showed up, a different system entirely). Whatever it is, it isn't
  `menagerie.php`'s `feed_pet`/`train_pet`.
- Whether leftover banked stat points really do carry forward across a milestone
  crossing, or reset — plausible from the cumulative "+N trained" display, not directly
  observed pre/post a second crossing.
- The exact per-tier point cost for tiers beyond each pet's current one (only the
  *next* tier's cost is ever shown).
