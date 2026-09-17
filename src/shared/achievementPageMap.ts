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
 * fresh from a 2026-09-17 archive capture for every page that had no
 * existing feature yet.
 *
 * Coarse for now (whole category, not yet split by line) on five pages —
 * real per-line data for "Combat & PvP" and "Shops & Economy" hasn't been
 * captured yet, so there's nothing to split by name against. Revisit once
 * a capture of those categories exists.
 *
 * `.ar-page` (Arena) and `.shop-hero` (Fifth Shop) were found on a second,
 * more careful pass — the first pass's `av2-sub` "marker" for Arena turned
 * out to be a dead CSS rule with no matching element anywhere in the page
 * (confirmed: exactly one occurrence in the whole document, inside
 * `<style>`, never as a real `class=` attribute), and `panel-content`
 * (Fifth Shop) was too generic a name to trust as unique without checking —
 * `.ar-page`/`.shop-hero` are each confirmed to occur exactly once, wrapping
 * that page's own hero/title content.
 *
 * Deliberately not wired at all yet: Black Market (every one of 105
 * captures in the archive came back `truncated: true` before the response
 * finished — what little was visible had no `class`/`id` anywhere, but a
 * real marker may simply be further into the page than any capture
 * reached), and the categories with no page decided yet (FRS, Player &
 * District Progression, Lore & Codex — see conversation).
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
    lineNames: 'all', // coarse — see module doc
  },
  {
    id: 'arena',
    marker: '.ar-page',
    category: 'Combat & PvP',
    lineNames: 'all', // coarse — see module doc
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
    lineNames: 'all', // coarse — see module doc
  },
  {
    id: 'vigilantes',
    marker: '.vig-page-header',
    category: 'Pets & Vigilantes',
    lineNames: 'all', // coarse — see module doc
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
    id: 'stockMarket',
    marker: '#lsv2-data',
    category: 'Shops & Economy',
    lineNames: 'all', // coarse — see module doc
  },
  {
    id: 'itemMarket',
    marker: '#sellGrid',
    category: 'Shops & Economy',
    lineNames: 'all', // coarse — see module doc
  },
  {
    id: 'fifthShop',
    marker: '.shop-hero',
    category: 'Shops & Economy',
    lineNames: 'all', // coarse — see module doc
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
];
