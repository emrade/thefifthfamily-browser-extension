# Halloween Massacre 2026

**Dates:** 1–31 October 2026.

**Sources:**
- The public event page, https://www.thefifthfamily.com/halloween.php (no login needed to read it), fetched 2026-09-29.
- The in-game event rules the player pasted on 2026-09-29.

Nothing here has been confirmed from captured traffic yet. See [Still unknown](#still-unknown).

## The core loop

Collect **Halloween Spirits** from normal play, then use them on other players to earn Event Score and Pumpkin Coins.

## Earning Spirits

| Source | Drop rule |
|---|---|
| Crimes, Careers, Street Intel | The first success each server day at each of the three is a guaranteed Spirit (3/day). Every success after that has a 19.5% chance. Failed rolls never drop. |
| Fight Club (PvP) | A flat 1% chance, not counted toward the daily cap. It's the only way past the cap. |

**Daily cap** across the three core mechanics:

| Day | Cap |
|---|---|
| Weekdays | 8 |
| Weekends | 13 |
| 31 October | 18 |

The event page says the cap "doubles at weekends". The pasted rules give 8 → 13, which isn't double. The pasted numbers are more specific, so they're the ones used here.

The server day is expected to reset at 23:00 UTC (midnight WAT), matching the other daily resets seen so far. See the `game_daily_reset_time` memory. This hasn't been checked for this event yet.

Hitting the cap every day is enough to earn all the event's rewards. The PvP drop only matters for making up a missed day or competing for the top of a leaderboard.

## Using a Spirit

- The **Use Spirit** button is under **Execute Attack**, and also on player profiles.
- It one-shots the target, whatever their stats.
- It costs no stamina, doesn't count toward the daily fight cap, and gives no respect, XP, cash or MG.
- **One hit per rival per day** (event page).
- Normal attack rules still apply. The target can't be:
  - in hospital,
  - in jail,
  - traveling,
  - within 10 minutes of leaving hospital.
- Truces and beginner protection still apply. Using a Spirit breaks your own truce, if you have one.

**Each hit gives:**
- +1 Event Score
- +10 Pumpkin Coins
- +1 Family score, if your Family is eligible

## Rewards

### Milestones (16 in total, from Event Score)

| Score | Reward |
|---|---|
| 150 | Reaper "Finger" (weapon; STR 259 / DEF 74 / AGI 74 / DEX 333) |
| 200 | La Última Ofrenda (motorcycle; SPD 275 / ACC 106 / HAN 90 / BST 380) |
| 250 | Black Cat (Legendary pet; STR 10 / DEF 10 / AGI 52 / DEX 38) |
| 270 | "I Exploded Everyone in 2026" (Epic badge) |
| 300 | Vampire Bat (Legendary pet; STR 7 / DEF 17 / AGI 45 / DEX 41) |
| ? | Autumn Facade (helmet; STR 83 / DEF 306 / AGI 83 / DEX 83) |
| ? | The Real Halloween Spirit (weapon; STR 481 / DEF 74 / AGI 74 / DEX 111) |

The other milestones aren't listed on the event page.

**Global 1st place** also gets the "First Winner of the Halloween Massacre" Legendary badge.

### Pumpkin Coin shop (34 items)

Consumables, Family and restore packs, 5 costumes and 6 Reaper Set pieces. Prices aren't on the event page.

**Costumes:** torso items that scale from Common to Fifth Family Mythic by level 180. Stats are as listed on the event page (presumably at Mythic).

| Costume | STR | DEF | AGI | DEX |
|---|---|---|---|---|
| Bee | 82 | 244 | 366 | 122 |
| Devil | 366 | 244 | 82 | 122 |
| Ghost | 82 | 244 | 122 | 366 |
| Wizard | 203 | 285 | 163 | 163 |
| Witch | 204 | 204 | 203 | 203 |

**Reaper Set:** 7 pieces. Six are sold in the shop, and Finger comes from the Score 150 milestone. Each set point is +0.15% Agility and Dexterity, so a full Mythic set is +10.5% to both.

| Piece | Slot | STR | DEF | AGI | DEX |
|---|---|---|---|---|---|
| Hands | Gloves | 96 | 72 | 96 | 217 |
| Sight | Helmet | 111 | 139 | 111 | 194 |
| Cloak | Torso | 163 | 285 | 122 | 244 |
| Finger | Weapon | 259 | 74 | 74 | 333 |
| Burden | Belt | 89 | 67 | 133 | 155 |
| Chain | Necklace | 100 | 77 | 78 | 115 |
| Spirit | Special | 199 | 100 | 200 | 167 |

### Treats and packs

- There are 15 treats.
- 5 Family packs (Iron River, Kito-gumi, Volkskaya, S.B.P., Viola), each giving 3 random treats from that Family plus +1 Family Favor.
- 3 universal packs, each giving 5 random treats from any Family.

### Login calendar

Log in on each calendar day to unlock that day's reward.

| Days | Reward |
|---|---|
| Weekdays | One of the five Family packs, in rotation |
| Weekends | 125 Pumpkin Coins |
| 28–30 Oct | Energy, Nerve and Stamina restore packs |
| 31 Oct | 1,000 Pumpkin Coins + 2 Halloween Spirits |

## Leaderboards

- **Global leaderboard:** every Spirit hit counts.
- **Family leaderboards:** every Family with 10+ members on 1 October gets its own private board.
  - Only Spirit hits on rivals score: +1 each, on top of the global point.
  - A hit only counts if you're in an eligible Family when you land it. Hits made while Familyless, or in a Family that didn't qualify, still count on the global board.
  - The top 5 in each Family win. Tied players share the place and both get the full prize.
  - Family prizes are separate from global prizes, so you can win both.

**Changing Family:**

| Event | What happens to your Family score |
|---|---|
| You leave | Reset to zero |
| You're kicked | You keep it |
| The Don disbands the Family | Wiped for everyone |
| You join a new Family | It comes with you and counts on their board |

## How the extension relates

- **Earning Spirits:** Crimes Auto, Career Auto and Street Intel Auto already do the three mechanics that drop Spirits. If they're on, they should get the 3 guaranteed daily Spirits and keep rolling toward the cap. None of them currently tracks Spirit drops.
- **Using Spirits:** nothing in the extension does this. It's a manual attack, limited to one per rival per day.

## Still unknown

Things that need an archive from 1 October onward to pin down:

- The endpoints and response fields for Spirit drops, the Spirit balance, Use Spirit and the event panel.
- Whether the automations' own requests show the Spirit drop in their responses.
- The Score thresholds for the unlisted milestones, and the shop prices.
- Whether the event day resets at 23:00 UTC.
