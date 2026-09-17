/**
 * Which achievement lines belong on which live page — the whole point of
 * the per-page Achievement chip over just linking to the Achievements page:
 * a category doesn't always map to one page (confirmed real: "Vehicles &
 * Chop Shop" spans both the Garage page, via its Garage/First Chop/Chop Shop
 * Revenue/etc. lines, and the Street Racing page, via its "Finish Line"
 * line alone) — so filtering happens by *line name*, not category name.
 * `lineNames: 'all'` is used where a category maps cleanly to one page.
 *
 * `marker` is the same "is this page actually on screen" CSS selector every
 * other content-script overlay already keys off of — reused directly from
 * the existing feature that owns each page where one already exists
 * (Street Racing's `RACING_MARKER`, Menagerie's `CARE_MARKER`, etc.), found
 * fresh from real archive captures for every page that had no existing
 * feature yet. Every marker below was confirmed to occur exactly once in
 * a real, non-truncated capture of that page.
 *
 * Every category's real line list (name + description) was pulled from a
 * 2026-09-17 archive where every one of the 25 achievement categories was
 * visited and captured in full — the three splits below (Combat & PvP,
 * Pets & Vigilantes, Shops & Economy) are built from those real
 * descriptions, not guessed from names alone:
 *
 * - **Combat & PvP**: "Fight Club Victor"/"Go the Distance"/"Street
 *   Dominance" all explicitly say "Fight Club" in their own description;
 *   "Last One Standing"/"Arena Reign" explicitly say "Arena". The remaining
 *   seven (Heavy Hitter, Hold the Line, Untouchable, Deadeye, Battle
 *   Companion, Dressed for War, Giant Killer) read as generic PvP mechanics
 *   with no mode named in their own text — but the player confirmed
 *   (2026-09-17) Arena resolves as a stat comparison and never actually
 *   touches an opponent's health, so dodge/block/crit/damage-dealt can only
 *   ever happen in Fight Club. All seven go there, not shared with Arena.
 * - **Pets & Vigilantes**: a clean split with no ambiguous lines — seven
 *   lines are explicitly about pets (Menagerie/Daily Care/Training
 *   Partners/etc.), five are explicitly about Vigilantes (Shard
 *   Hunter/Connections/Five Networks/etc.).
 * - **Shops & Economy**: turned out *not* to include the Stock Market at
 *   all — none of its 11 real lines mention stocks, trading, or shares.
 *   "Fifth Shop Customer"/"Fifth Shop Catalogue" go to the Fifth Shop;
 *   "Quick Sale" (its description literally says "Teaches quicksell") goes
 *   to the Item Market; "Black Market Contact"/"Back-Room Buyer"/"Fence
 *   Operator" go to the Black Market. "District Shopper" is on *both* Fifth
 *   Shop and Black Market — the player confirmed both restock different
 *   items per district, and the line's own text ("standard shops across all
 *   districts") doesn't distinguish between them. The remaining four
 *   (Secure Holdings, Lifetime Earnings, Gold Reserve, Diversified Empire)
 *   go to the Bank per the player — "Secure Holdings"' own progress text
 *   ("Purchase all 30 bank upgrades · 18 / 30") confirms it directly, and
 *   the other three (general Cash/Gold-earned meta stats) were grouped with
 *   it at the player's direction rather than left unmapped.
 *
 * Black Market's marker (`#bm-tab-v2`) came from a full, non-truncated
 * capture the player supplied directly — every one of the 105 Black Market
 * captures already in the archive had come back `truncated: true`, so the
 * page previously looked like it had no `class`/`id` at all. It does; the
 * truncation just always cut off before reaching them.
 *
 * Forge's marker (`.forge-hero`) came the same way — a full capture the
 * player supplied directly after every prior archive capture of the page
 * came back truncated before reaching any usable selector.
 *
 * Categories with no page decided yet: FRS, Player & District Progression,
 * Lore & Codex (see conversation — Lore & Codex in particular was described
 * as cutting across the whole game rather than belonging to one page).
 */
export interface AchievementPageScope {
  /** Human label only, for logging — not a lookup key. */
  id: string;
  marker: string;
  category: string;
  lineNames: string[] | 'all';
}

export const ACHIEVEMENT_PAGE_SCOPES: AchievementPageScope[] = [
  {
    id: 'garage',
    marker: '.xp-wrap',
    category: 'Vehicles & Chop Shop',
    lineNames: ['Garage', 'District Rides', 'Family Fleet', 'Parts Changed', 'Donor Network', 'First Chop', 'Chop Shop Revenue'],
  },
  {
    id: 'streetRacing',
    marker: '#rv2-root',
    category: 'Vehicles & Chop Shop',
    lineNames: ['Finish Line'],
  },
  {
    id: 'fightClub',
    marker: '.fc-hero',
    category: 'Combat & PvP',
    // All ten Combat & PvP lines not explicitly about Arena — see the
    // module doc's Combat & PvP note for why the seven generic-mechanic
    // ones (Heavy Hitter onward) belong here and not on Arena too.
    lineNames: ['Fight Club Victor', 'Go the Distance', 'Street Dominance', 'Heavy Hitter', 'Hold the Line', 'Untouchable', 'Deadeye', 'Battle Companion', 'Dressed for War', 'Giant Killer'],
  },
  {
    id: 'arena',
    marker: '.ar-page',
    category: 'Combat & PvP',
    // Arena resolves as a stat comparison, not live combat — confirmed by
    // the player (2026-09-17): it never touches an opponent's health, so
    // none of Fight Club's dodge/block/crit/damage-dealt mechanics can
    // actually happen here despite their descriptions not naming a mode.
    // Only the two lines whose own description explicitly says "Arena"
    // belong here.
    lineNames: ['Last One Standing', 'Arena Reign'],
  },
  {
    id: 'streetIntel',
    marker: '.si-cards',
    category: 'Street Intel',
    lineNames: 'all',
  },
  {
    id: 'menagerie',
    marker: '.men-care',
    category: 'Pets & Vigilantes',
    lineNames: ['Menagerie', 'District Companions', 'Family Companions', 'Daily Care', 'Training Partners', 'Growing Together', 'Developed Menagerie'],
  },
  {
    id: 'vigilantes',
    marker: '.vig-page-header',
    category: 'Pets & Vigilantes',
    lineNames: ['Shard Hunter', 'Connections', 'Five Networks', 'Rising Stars', 'Complete Network'],
  },
  {
    id: 'smuggling',
    marker: '.sv2-monitor-board',
    category: 'Smuggling',
    lineNames: 'all',
  },
  {
    id: 'realEstate',
    marker: '.rev2-card.owned',
    category: 'Real Estate',
    lineNames: 'all',
  },
  {
    id: 'itemMarket',
    marker: '#sellGrid',
    category: 'Shops & Economy',
    lineNames: ['Quick Sale'],
  },
  {
    id: 'fifthShop',
    marker: '.shop-hero',
    category: 'Shops & Economy',
    // "District Shopper" is deliberately on both Fifth Shop and Black
    // Market — the player confirmed both restock different items per
    // district, and its own description ("standard shops across all
    // districts") doesn't distinguish between them.
    lineNames: ['Fifth Shop Customer', 'Fifth Shop Catalogue', 'District Shopper'],
  },
  {
    id: 'blackMarket',
    marker: '#bm-tab-v2',
    category: 'Shops & Economy',
    lineNames: ['Black Market Contact', 'Back-Room Buyer', 'Fence Operator', 'District Shopper'],
  },
  {
    id: 'bank',
    marker: '.bank-terminal',
    category: 'Shops & Economy',
    // Confirmed by the player: "Secure Holdings"' own progress text reads
    // "Purchase all 30 bank upgrades · 18 / 30" — unambiguously the Bank
    // page, not Stock Market. The other three (general Cash/Gold-earned
    // meta stats, previously left unmapped) go here too, per the player.
    lineNames: ['Secure Holdings', 'Lifetime Earnings', 'Gold Reserve', 'Diversified Empire'],
  },
  {
    id: 'emergency',
    marker: '.em-status-grid',
    category: 'Heat, Jail & Hospital',
    lineNames: 'all',
  },
  {
    id: 'inventory',
    marker: '.eq-layout',
    category: 'Equipment & Sets',
    lineNames: 'all',
  },
  {
    id: 'familyHq',
    marker: '.fhq-page',
    category: 'Family Upgrades',
    lineNames: 'all',
  },
  {
    id: 'academy',
    marker: '.acd-wrap',
    category: 'Academy',
    lineNames: 'all',
  },
  {
    id: 'careers',
    marker: '.cv2-tabs',
    category: 'Careers',
    lineNames: 'all',
  },
  {
    id: 'crimes',
    marker: '.crime-hero-banner',
    category: 'Crimes',
    lineNames: 'all',
  },
  {
    id: 'heists',
    marker: '.heist-grid',
    category: 'Heists',
    lineNames: 'all',
  },
  {
    id: 'travel',
    marker: '.tp-wrap',
    category: 'Travel',
    lineNames: 'all',
  },
  {
    id: 'rackets',
    marker: '.rkv2-hero',
    category: 'Rackets',
    lineNames: 'all',
  },
  {
    id: 'mansion',
    marker: '.est2-hero',
    category: 'Estate',
    lineNames: 'all',
  },
  {
    id: 'bloodline',
    marker: '.bl-hero',
    category: 'Bloodlines',
    lineNames: 'all',
  },
  {
    id: 'bloodBonds',
    marker: '.bb-hero',
    category: 'Blood Bonds',
    lineNames: 'all',
  },
  {
    id: 'battlePass',
    marker: '.bp-hero',
    category: 'Battle Pass',
    lineNames: 'all',
  },
  {
    id: 'forge',
    marker: '.forge-hero',
    category: 'Forge',
    lineNames: 'all',
  },
];
