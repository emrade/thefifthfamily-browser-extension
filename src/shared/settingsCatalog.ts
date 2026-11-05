import { NOTIFICATION_DEFINITIONS, type NotificationId } from './notifications';
import { PAGE_FEATURE_DEFINITIONS, type PageFeatureId } from './pageFeatures';

/**
 * Where every setting sits on the Dashboard's Settings page. Notifications and
 * page features keep their own registries; this only places them. Both maps are
 * typed by id, so adding a setting without choosing its place fails the build
 * rather than leaving it missing from the page.
 */

export type SettingTabId = 'combat' | 'crime' | 'money' | 'general';

export const SETTING_TABS: { id: SettingTabId; label: string }[] = [
  { id: 'combat', label: 'Combat' },
  { id: 'crime', label: 'Crime & Jobs' },
  { id: 'money', label: 'Money & Items' },
  { id: 'general', label: 'General' },
];

export type SettingEntry =
  | { kind: 'page'; id: PageFeatureId; tab: SettingTabId; group: string; label: string; description: string }
  | { kind: 'notification'; id: NotificationId; tab: SettingTabId; group: string; label: string; description: string }
  | { kind: 'queue' | 'export' | 'reset'; id: string; tab: SettingTabId; group: string; label: string; description: string };

type Place = [tab: SettingTabId, group: string];

const ARENA: Place = ['combat', 'Arena'];
const FIGHT_CLUB: Place = ['combat', 'Fight Club'];
const GOLD_RUN: Place = ['combat', 'Gold Run'];
const STREET_INTEL: Place = ['crime', 'Street Intel'];
const CRIMES: Place = ['crime', 'Crimes'];
const CAREER: Place = ['crime', 'Career'];
const COURIERS: Place = ['money', 'Pet Couriers'];
const REAL_ESTATE: Place = ['money', 'Real Estate'];
const STOCKS: Place = ['money', 'Stock Market'];
const INVENTORY: Place = ['money', 'Inventory'];
const GARAGE: Place = ['money', 'Garage'];
const RACING: Place = ['money', 'Street Racing'];
const FORGE: Place = ['money', 'Forge'];
const MENAGERIE: Place = ['money', 'Menagerie'];
const ACHIEVEMENTS: Place = ['money', 'Achievements'];
const AUTOMATIONS: Place = ['general', 'Automations'];
const ALERTS: Place = ['general', 'Alerts'];
const DATA: Place = ['general', 'Data'];

const PAGE_FEATURE_PLACES: Record<PageFeatureId, Place> = {
  fightClubToolbar: FIGHT_CLUB,
  fightClubRecon: FIGHT_CLUB,
  goldRunPanel: GOLD_RUN,
  streetIntelHighlights: STREET_INTEL,
  streetIntelExactOdds: STREET_INTEL,
  streetIntelComplicationHint: STREET_INTEL,
  streetIntelStatusPanel: STREET_INTEL,
  careerAutoPanel: CAREER,
  courierPanel: COURIERS,
  realEstateAdvisor: REAL_ESTATE,
  menagerieAssistant: MENAGERIE,
  streetRacingOverlay: RACING,
  inventoryQuickSell: INVENTORY,
  inventoryAutoSell: INVENTORY,
  stockMarketStatus: STOCKS,
  achievementChip: ACHIEVEMENTS,
  forgeAdvisor: FORGE,
  arenaOverlay: ARENA,
  arenaFightAdvisor: ARENA,
  arenaMasteryTag: ARENA,
  arenaGamePctGate: ARENA,
  arenaShowGamePct: ARENA,
  arenaBankOrFight: ARENA,
  arenaOpponentMemory: ARENA,
  automationUpNextChip: AUTOMATIONS,
  garageBulkOps: GARAGE,
};

const NOTIFICATION_PLACES: Record<NotificationId, Place> = {
  travelArrival: ALERTS,
  streetIntelOpportunity: STREET_INTEL,
  streetIntelAutoStopped: STREET_INTEL,
  careerAutoStopped: CAREER,
  crimesAutoDistrictMastered: CRIMES,
  crimesAutoStopped: CRIMES,
  stockMarketTrackerPaused: STOCKS,
  courierDestinationOpen: COURIERS,
  courierAutoDispatched: COURIERS,
  courierAutoStopped: COURIERS,
  goldRunStopped: GOLD_RUN,
  arenaPageUnlocked: ARENA,
  realEstateVaultFull: REAL_ESTATE,
  realEstateAutoStopped: REAL_ESTATE,
  archiveExportReminder: ALERTS,
};

/** Page features come before notifications within a group, then registry order. */
export const SETTING_ENTRIES: SettingEntry[] = [
  ...PAGE_FEATURE_DEFINITIONS.map((def): SettingEntry => ({
    kind: 'page',
    id: def.id,
    tab: PAGE_FEATURE_PLACES[def.id][0],
    group: PAGE_FEATURE_PLACES[def.id][1],
    label: def.label,
    description: def.description,
  })),
  ...NOTIFICATION_DEFINITIONS.map((def): SettingEntry => ({
    kind: 'notification',
    id: def.id,
    tab: NOTIFICATION_PLACES[def.id][0],
    group: NOTIFICATION_PLACES[def.id][1],
    label: def.label,
    description: def.description,
  })),
  {
    kind: 'queue',
    id: 'automationQueue',
    tab: AUTOMATIONS[0],
    group: AUTOMATIONS[1],
    label: 'Automation Queue',
    description: 'Automations take turns: one at a time, with a 3–8 s gap between them, like a player switching pages. Off: they run exactly as before. Takes effect on the next check.',
  },
  { kind: 'export', id: 'exportData', tab: DATA[0], group: DATA[1], label: 'Download All Data', description: 'Saves everything the extension has stored to a backup file.' },
  { kind: 'reset', id: 'resetData', tab: DATA[0], group: DATA[1], label: 'Clear All Data', description: 'Erases every trade, price and customs record. This can’t be undone.' },
];

/** Every word must appear somewhere in the setting's name, description or place,
 *  so "arena reminder" finds it in any order. */
export function matchesSearch(entry: SettingEntry, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tabLabel = SETTING_TABS.find((t) => t.id === entry.tab)?.label ?? '';
  const haystack = `${entry.label} ${entry.description} ${entry.group} ${tabLabel}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Groups in the order they first appear, keeping each group's entries in order. */
export function groupEntries(entries: SettingEntry[]): { group: string; entries: SettingEntry[] }[] {
  const groups = new Map<string, SettingEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.group);
    if (list) list.push(entry);
    else groups.set(entry.group, [entry]);
  }
  return [...groups].map(([group, list]) => ({ group, entries: list }));
}
