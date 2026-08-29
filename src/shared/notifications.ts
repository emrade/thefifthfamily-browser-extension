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
  {
    id: 'careerAutoStopped',
    label: 'Career Auto Stopped',
    description: 'Notify when the career auto-runner stops itself, e.g. after getting fired.',
  },
  {
    id: 'streetIntelAutoStopped',
    label: 'Street Intel Auto Stopped',
    description: 'Notify when the Street Intel auto-runner stops itself after an unrecognized response.',
  },
  {
    id: 'stockMarketTrackerPaused',
    label: 'Stock Market Tracker Paused',
    description: 'Notify when the Stock Market Tracker stops itself after a response it doesn’t recognize, so it never keeps hitting the same unexplained behavior unattended.',
  },
  {
    id: 'courierDestinationOpen',
    label: 'Courier Destination Open',
    description: 'Notify when a smuggling destination opens up and auto-dispatch is off, so you know pets are ready to send.',
  },
  {
    id: 'courierAutoDispatched',
    label: 'Courier Auto-Dispatched',
    description: 'Notify when pet couriers were automatically sent out because a destination opened up.',
  },
  {
    id: 'courierAutoStopped',
    label: 'Courier Auto-Watch Stopped',
    description: 'Notify when the pet courier auto-watch stops itself after an unrecognized response.',
  },
] as const;

export type NotificationId = (typeof NOTIFICATION_DEFINITIONS)[number]['id'];

export type NotificationPreferences = Record<NotificationId, boolean>;

// Every notification is enabled by default (player request) — opt-out, not opt-in.
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = Object.fromEntries(
  NOTIFICATION_DEFINITIONS.map((def) => [def.id, true]),
) as NotificationPreferences;
