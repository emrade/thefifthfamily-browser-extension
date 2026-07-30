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
] as const;

export type PageFeatureId = (typeof PAGE_FEATURE_DEFINITIONS)[number]['id'];

export type PageFeaturePreferences = Record<PageFeatureId, boolean>;

// Enabled by default (player request) — opt-out, not opt-in, same as notifications.
export const DEFAULT_PAGE_FEATURE_PREFERENCES: PageFeaturePreferences = Object.fromEntries(
  PAGE_FEATURE_DEFINITIONS.map((def) => [def.id, true]),
) as PageFeaturePreferences;
