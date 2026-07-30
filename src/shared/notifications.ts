/**
 * Single registry of every notification type the extension can fire. Adding a new
 * notification anywhere in the codebase should only ever mean adding one entry here
 * and calling `notify(id, ...)` (see notify.ts) — the Settings toggle list and the
 * default-preferences object both derive from this array, so neither needs touching
 * by hand for a new notification to show up as a togglable setting.
 */
export const NOTIFICATION_DEFINITIONS = [
  {
    id: 'travelArrival',
    label: 'Travel Arrival',
    description: 'Notify when you land after traveling.',
  },
  {
    id: 'customsRaid',
    label: 'Customs Raid',
    description: "Notify when a background check finds an unresolved customs raid.",
  },
  {
    id: 'sellOpportunity',
    label: 'Sell Opportunity',
    description: "Notify when cargo you're holding becomes profitable to sell.",
  },
  {
    id: 'streetIntelOpportunity',
    label: 'Street Intel Opportunity',
    description: 'Notify when your cooldown clears and a medium-risk-or-better job is available.',
  },
] as const;

export type NotificationId = (typeof NOTIFICATION_DEFINITIONS)[number]['id'];

export type NotificationPreferences = Record<NotificationId, boolean>;

// Every notification is enabled by default (player request) — opt-out, not opt-in.
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = Object.fromEntries(
  NOTIFICATION_DEFINITIONS.map((def) => [def.id, true]),
) as NotificationPreferences;
