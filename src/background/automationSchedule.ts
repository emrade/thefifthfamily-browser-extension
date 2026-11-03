import { ALARM_NAMES } from '@/shared/constants';
import { storage } from '@/shared/storage';
import type { AutomationQueueFeature, AutomationScheduleItem, AutomationScheduleSnapshot } from '@/shared/types';
import type { ExtensionMessage } from '@/shared/messaging';
import { getQueueState } from './automationQueue';

/**
 * "What runs next" for the dashboard and the "Up next" chip. Read-only: it
 * looks at each automation's own switch and its own alarm, plus the queue's
 * in-memory state, and sends nothing to the game.
 *
 * A scheduled time is the automation's next *check*. A check can find
 * nothing to do (e.g. no Street Intel card worth taking).
 */

interface Scheduled {
  feature: AutomationQueueFeature;
  alarms: string[];
  isOn: () => Promise<boolean>;
}

const SCHEDULED: Scheduled[] = [
  {
    feature: 'pet-courier',
    alarms: [ALARM_NAMES.SMUGGLING_DEST_POLL, ALARM_NAMES.SMUGGLING_COURIER_RETURN],
    isOn: async () => {
      const c = await storage.getCourierAutoConfig();
      return c.watchEnabled || c.autoDispatchEnabled || c.autoOffloadEnabled;
    },
  },
  { feature: 'street-intel', alarms: [ALARM_NAMES.STREET_INTEL_AUTO], isOn: async () => (await storage.getStreetIntelAutoConfig()).enabled },
  { feature: 'career-auto', alarms: [ALARM_NAMES.CAREER_AUTO], isOn: async () => (await storage.getCareerAutoConfig()).enabled },
  { feature: 'crimes-auto', alarms: [ALARM_NAMES.CRIMES_AUTO], isOn: async () => (await storage.getCrimesAutoConfig()).enabled },
  { feature: 'real-estate-auto', alarms: [ALARM_NAMES.REAL_ESTATE_AUTO], isOn: async () => (await storage.getRealEstateAutoConfig()).enabled },
  { feature: 'stock-market', alarms: [ALARM_NAMES.STOCK_MARKET_POLL], isOn: async () => (await storage.getPageFeaturePreferences()).stockMarketStatus },
];

const STATE_ORDER: Record<AutomationScheduleItem['state'], number> = { running: 0, waiting: 1, scheduled: 2, off: 3 };

export async function getAutomationSchedule(): Promise<AutomationScheduleSnapshot> {
  const [queue, alarms] = await Promise.all([getQueueState(), chrome.alarms.getAll()]);
  const alarmAt = new Map(alarms.map((a) => [a.name, a.scheduledTime]));
  const items: AutomationScheduleItem[] = [];

  for (const s of SCHEDULED) {
    const times = s.alarms.map((n) => alarmAt.get(n)).filter((t): t is number => typeof t === 'number');
    const nextAt = times.length ? Math.min(...times) : null;
    const state: AutomationScheduleItem['state'] = queue.running.includes(s.feature)
      ? 'running'
      : queue.waiting.includes(s.feature)
        ? 'waiting'
        : (await s.isOn())
          ? 'scheduled'
          : 'off';
    items.push({ feature: s.feature, state, nextAt: state === 'off' ? null : nextAt });
  }

  // Player-started ones (Garage, Inventory, Racing, achievement claims) have
  // no schedule: listed only while running or waiting.
  for (const f of new Set<AutomationQueueFeature>([...queue.running, ...queue.waiting])) {
    if (items.some((i) => i.feature === f)) continue;
    items.push({ feature: f, state: queue.running.includes(f) ? 'running' : 'waiting', nextAt: null });
  }

  items.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity));
  return { now: Date.now(), queueEnabled: queue.enabled, holder: queue.holder, items };
}

export const AUTOMATION_DASHBOARD_PATH = 'src/dashboard/index.html';

const PING_TIMEOUT_MS = 500;

/** Asks an open dashboard tab for its own tab id. Undefined when none is open
 *  (no listener rejects; other extension pages don't answer this message). */
async function findOpenDashboard(): Promise<{ tabId: number; windowId: number } | undefined> {
  const msg: ExtensionMessage = { type: 'automation-dashboard-ping' };
  const reply = chrome.runtime.sendMessage(msg).catch(() => undefined) as Promise<{ tabId: number; windowId: number } | undefined>;
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), PING_TIMEOUT_MS));
  const found = await Promise.race([reply, timeout]);
  return found && typeof found.tabId === 'number' ? found : undefined;
}

/** Switches to the dashboard if a tab already shows it, otherwise opens it.
 *  Finding it this way avoids asking for the "tabs" permission. */
export async function openAutomationDashboard(): Promise<void> {
  const open = await findOpenDashboard();
  if (open) {
    try {
      await chrome.tabs.update(open.tabId, { active: true });
      await chrome.windows.update(open.windowId, { focused: true });
      return;
    } catch {
      // The tab closed in the meantime: fall through and open a new one.
    }
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(AUTOMATION_DASHBOARD_PATH) });
}
