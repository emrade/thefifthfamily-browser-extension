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
 *   Companion, Dressed for War, Giant Killer) describe generic PvP
 *   mechanics with no mode named, so they're shown on both pages.
 * - **Pets & Vigilantes**: a clean split with no ambiguous lines — seven
 *   lines are explicitly about pets (Menagerie/Daily Care/Training
 *   Partners/etc.), five are explicitly about Vigilantes (Shard
 *   Hunter/Connections/Five Networks/etc.).
 * - **Shops & Economy**: turned out *not* to include the Stock Market at
 *   all — none of its 11 real lines mention stocks, trading, or shares.
 *   "Fifth Shop Customer"/"Fifth Shop Catalogue" go to the Fifth Shop;
 *   "Quick Sale" (its description literally says "Teaches quicksell") goes
 *   to the Item Market; "Black Market Contact"/"Back-Room Buyer"/"Fence
 *   Operator" belong to the Black Market (still unwired — see below) once
 *   it has a marker. The other five (District Shopper, Secure Holdings,
 *   Lifetime Earnings, Gold Reserve, Diversified Empire) describe
 *   account-wide economic behavior with no single owning page, so they're
 *   left unmapped rather than attached somewhere misleading.
 *
 * Deliberately not wired at all yet: Black Market and Forge — every
 * capture of either in the archive (105 for Black Market, every Forge
 * capture across all four archives) came back `truncated: true` before the
 * response finished. What little of Black Market was visible had no
 * `class`/`id` anywhere at all; Forge was never captured far enough in to
 * check. And the categories with no page decided yet: FRS, Player &
 * District Progression, Lore & Codex (see conversation — Lore & Codex in
 * particular was described as cutting across the whole game rather than
 * belonging to one page).
 */
export interface AchievementPageScope {
  /** Human label only, for logging — not a lookup key. */
  id: string;
  marker: string;
  category: string;
  lineNames: string[] | 'all';
}

const COMBAT_PVP_SHARED = ['Heavy Hitter', 'Hold the Line', 'Untouchable', 'Deadeye', 'Battle Companion', 'Dressed for War', 'Giant Killer'];

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
    lineNames: ['Fight Club Victor', 'Go the Distance', 'Street Dominance', ...COMBAT_PVP_SHARED],
  },
  {
    id: 'arena',
    marker: '.ar-page',
    category: 'Combat & PvP',
    lineNames: ['Last One Standing', 'Arena Reign', ...COMBAT_PVP_SHARED],
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
    lineNames: ['Fifth Shop Customer', 'Fifth Shop Catalogue'],
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
];
