/**
 * Registry of every content-script feature that injects its own UI directly into
 * the live game page (as opposed to living only in the popup) — Fight Club's sort/
 * filter toolbar, Street Intel's best-value/best-odds highlights. Same self-
 * registering shape as notifications.ts: add an entry here and the Settings toggle
 * list picks it up automatically, nothing else to wire by hand.
 */
export const PAGE_FEATURE_DEFINITIONS = [
  {
    id: 'fightClubToolbar',
    label: 'Fight Club Toolbar',
    description: 'Adds a sort and max-rating filter toolbar to the Fight Club target list.',
  },
  {
    id: 'fightClubRecon',
    label: 'Fight Club Recon',
    description:
      'Surfaces the win-odds/threat/steal-estimate the game already computes for a target — automatically when you open their attack view, or on demand via a Recon button added to each target card.',
  },
  {
    id: 'streetIntelHighlights',
    label: 'Street Intel Highlights',
    description: 'Highlights the best-value job, risky-but-lucrative jobs, and the best scout odds on the Street Intel page.',
  },
  {
    id: 'courierPanel',
    label: 'Pet Courier Panel',
    description: 'A floating panel on the Smuggling page with a Run button and last-run summary, so running couriers doesn’t need the popup open.',
  },
  {
    id: 'streetIntelStatusPanel',
    label: 'Street Intel Status Panel',
    description: 'A floating panel on the Street Intel page showing the Auto-Attempt toggle, today’s attempts and earnings, and the last result — no popup needed to check.',
  },
  {
    id: 'realEstateAdvisor',
    label: 'Real Estate Advisor',
    description: 'Shows what each property actually earns you per day, flags any losing income to a vault too small for its revenue, and tells you the exact level (and cost) to fix it, on the Real Estate page.',
  },
  {
    id: 'menagerieAssistant',
    label: 'Menagerie Assistant',
    description: 'On the Menagerie Care tab, shows each pet’s banked stat points against what its next Smuggling capacity/speed milestone actually needs — no more switching between the two pages per pet to check.',
  },
  {
    id: 'streetRacingOverlay',
    label: 'Street Racing Overlay',
    description:
      'A floating panel on the Street Racing page listing every race with a Run button, so you can clear the day’s attempts without playing the timing mini-game — accuracy and race timing are sampled from this account’s own real results, not maxed out.',
  },
  {
    id: 'itemMarketAdvisor',
    label: 'Item Market Price Advisor',
    description:
      'On the Item Market’s "List an Item for Sale" form, badges every item with how many sold market-wide this week, and suggests a listing price (undercutting the cheapest current ask, or matching the 7-day average when nothing’s listed) with a one-click "Use This" button.',
  },
  {
    id: 'stockMarketStatus',
    label: 'Stock Market Tracker',
    description:
      'Collects Stock Market price and rumor history in the background (for a future trading feature) and shows a status overlay confirming it on the Stock Market page. Turning this off stops the background collection immediately; the overlay itself clears on the next reload.',
  },
  {
    id: 'achievementChip',
    label: 'Achievement Tracker',
    description:
      'A small icon at the top-right of the page (on 26 pages so far) showing only the achievement lines relevant to that page — current tier, progress to the next one, and a Claim button the moment a line is ready. Click it to open.',
  },
  {
    id: 'garageBulkOps',
    label: 'Garage & Dealership Bulk Tools',
    description:
      'A floating panel on the Garage & Dealership page for buying vehicles in bulk (shows the total cost so you can withdraw it first), stripping parts from multiple vehicles at once, deleting multiple stripped bodies, and auto-fitting spare parts into one or many empty vehicles — all confirmed (with the exact cost) before running, and all showing live progress while they run. Vehicles you mark Do Not Touch (and your active vehicle, which the game itself protects) are greyed out and skipped for stripping/deleting.',
  },
] as const;

export type PageFeatureId = (typeof PAGE_FEATURE_DEFINITIONS)[number]['id'];

export type PageFeaturePreferences = Record<PageFeatureId, boolean>;

// Enabled by default (player request) — opt-out, not opt-in, same as notifications.
export const DEFAULT_PAGE_FEATURE_PREFERENCES: PageFeaturePreferences = Object.fromEntries(
  PAGE_FEATURE_DEFINITIONS.map((def) => [def.id, true]),
) as PageFeaturePreferences;
