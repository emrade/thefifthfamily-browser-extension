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
    id: 'realEstateAdvisor',
    label: 'Real Estate Advisor',
    description: 'Shows what each property actually earns you per day, flags any losing income to a vault too small for its revenue, and tells you the exact level (and cost) to fix it, on the Real Estate page.',
  },
] as const;

export type PageFeatureId = (typeof PAGE_FEATURE_DEFINITIONS)[number]['id'];

export type PageFeaturePreferences = Record<PageFeatureId, boolean>;

// Enabled by default (player request) — opt-out, not opt-in, same as notifications.
export const DEFAULT_PAGE_FEATURE_PREFERENCES: PageFeaturePreferences = Object.fromEntries(
  PAGE_FEATURE_DEFINITIONS.map((def) => [def.id, true]),
) as PageFeaturePreferences;
