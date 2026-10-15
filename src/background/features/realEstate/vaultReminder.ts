import { ALARM_NAMES, GAME_ORIGIN, REAL_ESTATE_VAULT_NOTIFICATION_ID } from '@/shared/constants';
import { db } from '@/shared/db';
import { decompressText } from '@/shared/requestLog/compress';
import { LOG_PREFIX } from '@/shared/log';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { notify } from '@/shared/notify';
import { recordParseFailure, recordParseSuccess } from '@/shared/featureHealth';
import { storage } from '@/shared/storage';
import { fullAt, parsePropertyVaults, unwrapPanelHtml, vaultAlert, type VaultAlert } from '@/shared/realEstateVaults';
import type { ExtensionMessage } from '@/shared/messaging';
import type { RealEstateVault, RealEstateVaultState } from '@/shared/types';

/**
 * The Real Estate vault reminder: one notification per collection, when the
 * vaults already full earn enough of the portfolio's hourly income that the
 * rest is going to waste (`VAULT_ALERT_INCOME_SHARE`). Read-only: it never
 * collects. The player chose a reminder over auto-collecting (2026-10-15):
 * overflow was only ~1% of income, not worth a background automation.
 *
 * Timing comes from what the page already loads (content/features/realEstate
 * /vaultCapture.ts): each Properties panel gives every vault's amount, cap
 * and hourly income, and each Collect / Collect All empties them. The alarm
 * goes off when the threshold should be reached; before notifying, one read
 * of the same Properties panel the page loads confirms it, so a collection
 * made on another device moves the alarm instead of raising a false alert.
 *
 * No kill switch of its own, same as the Arena page reminder: the player
 * silences it with the `realEstateVaultFull` notification preference, which
 * also stops the confirm read.
 */

const FEATURE_KEY = 'realEstate';
/** Never re-check sooner than this after a confirm read that wasn't there
 *  yet (the live vault grows in whole hours). */
const MIN_RECHECK_MS = 5 * 60_000;
/** Collections kept for the advisor's measured figures (it uses 7 days). */
const REAL_ESTATE_COLLECTION_HISTORY_DAYS = 14;
const COLLECT_ENDPOINT = 'POST /actions/properties_v2.php';

type Collection = NonNullable<RealEstateVaultState['collections']>[number];

function withCollection(list: Collection[] | undefined, c: Collection): Collection[] {
  const since = Date.now() - REAL_ESTATE_COLLECTION_HISTORY_DAYS * 86_400_000;
  const kept = (list ?? []).filter((x) => x.at >= since && !(x.at === c.at && x.key === c.key));
  return [...kept, c].sort((a, b) => a.at - b.at);
}

/**
 * Collections from before this history was kept, read back from the
 * extension's own request archive (30 days, when archiving is on), so the
 * advisor has a week of figures from the first day rather than a week later.
 */
async function backfillCollections(): Promise<Collection[]> {
  const since = Date.now() - REAL_ESTATE_COLLECTION_HISTORY_DAYS * 86_400_000;
  const rows = await db.requestLog
    .where('[endpoint+timestamp]')
    .between([COLLECT_ENDPOINT, since], [COLLECT_ENDPOINT, Infinity])
    .toArray();
  const out: Collection[] = [];
  for (const row of rows) {
    if (!row.requestBody) continue;
    const body = new URLSearchParams(await decompressText(row.requestBody, row.encoding));
    const action = body.get('action');
    if (action !== 'collect_all' && action !== 'collect') continue;
    try {
      if (JSON.parse(await decompressText(row.responseBody, row.encoding))?.ok !== true) continue;
    } catch {
      continue;
    }
    const c = { at: row.timestamp, key: action === 'collect' ? body.get('property_id') : null };
    if (!out.some((x) => x.at === c.at && x.key === c.key)) out.push(c);
  }
  return out.sort((a, b) => a.at - b.at);
}

function schedule(alert: VaultAlert | null, notBefore = Date.now()): void {
  if (!alert || alert.at <= Date.now()) {
    void chrome.alarms.clear(ALARM_NAMES.REAL_ESTATE_VAULT);
    return;
  }
  chrome.alarms.create(ALARM_NAMES.REAL_ESTATE_VAULT, { when: Math.max(alert.at, notBefore) });
}

async function save(state: RealEstateVaultState): Promise<void> {
  await storage.setRealEstateVaults(state);
}

export async function handleMessage(msg: ExtensionMessage): Promise<void> {
  if (msg.type === 'real-estate-vaults-observed') {
    const prev = await storage.getRealEstateVaults();
    const vaults: RealEstateVault[] = msg.vaults.map((v) => ({ ...v, at: msg.at }));
    const alert = vaultAlert(vaults);
    // Still short of the threshold means this is a new round (collected
    // here or elsewhere since the last alert).
    const fresh = !alert || alert.at > Date.now();
    await save({ vaults, notifiedAt: fresh ? null : (prev?.notifiedAt ?? null), collections: prev?.collections });
    schedule(alert);
    return;
  }
  if (msg.type === 'real-estate-collected') {
    const prev = await storage.getRealEstateVaults();
    const collections = withCollection(prev?.collections, { at: msg.at, key: msg.propertyKey });
    const vaults = (prev?.vaults ?? []).map((v) => (msg.propertyKey === null || v.key === msg.propertyKey ? { ...v, vault: 0, at: msg.at } : v));
    await save({ vaults, notifiedAt: null, collections });
    schedule(vaultAlert(vaults));
  }
}

async function readLiveVaults(): Promise<RealEstateVault[] | null> {
  try {
    const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?type=properties&_t=${Date.now()}`, { credentials: 'include' });
    const html = unwrapPanelHtml(await res.text());
    const parsed = html ? parsePropertyVaults(html) : [];
    if (parsed.length === 0) {
      recordParseFailure(FEATURE_KEY);
      return null;
    }
    recordParseSuccess(FEATURE_KEY);
    const now = Date.now();
    return parsed.map((v) => ({ ...v, at: now }));
  } catch (err) {
    console.error(LOG_PREFIX, 'real estate vault read failed', err);
    return null;
  }
}

function money(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;
}

function describe(alert: VaultAlert): string {
  const names = alert.full.map((v) => v.name);
  const who = names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  const next = alert.next
    ? ` ${alert.next.name} fills at ${new Date(fullAt(alert.next)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
    : '';
  return `${who} ${names.length === 1 ? 'is' : 'are'} full: about ${money(alert.wastedPerHour)}/hr is going to waste until you collect.${next}`;
}

// Two alarm deliveries (a dormant worker can fire one alarm twice) must not
// both read and notify.
let checkInFlight = false;

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  if (alarm.name !== ALARM_NAMES.REAL_ESTATE_VAULT || checkInFlight) return;
  checkInFlight = true;
  try {
    const prefs = await storage.getNotificationPreferences();
    if (!prefs.realEstateVaultFull) return;
    const state = await storage.getRealEstateVaults();
    if (!state || state.notifiedAt !== null) return;

    // Prefer the live vaults; if they can't be read (logged out, offline),
    // fall back to the estimate rather than dropping the reminder.
    const live = await readLiveVaults();
    const vaults = live ?? state.vaults;
    const alert = vaultAlert(vaults);
    if (alert && alert.at > Date.now() + 60_000) {
      await save({ ...state, vaults, notifiedAt: null });
      schedule(alert, Date.now() + MIN_RECHECK_MS);
      return;
    }
    if (!alert) return;
    await chrome.notifications.clear(REAL_ESTATE_VAULT_NOTIFICATION_ID);
    await notify(
      'realEstateVaultFull',
      { type: 'basic', iconUrl: chrome.runtime.getURL('icons/icon-128.png'), title: 'Property vaults full', message: describe(alert) },
      REAL_ESTATE_VAULT_NOTIFICATION_ID,
    );
    await save({ ...state, vaults, notifiedAt: Date.now() });
  } finally {
    checkInFlight = false;
  }
}

/** Clicking the notification brings the game forward and dismisses it. */
async function handleNotificationClick(notificationId: string): Promise<void> {
  if (notificationId !== REAL_ESTATE_VAULT_NOTIFICATION_ID) return;
  await chrome.notifications.clear(notificationId);
  const [tab] = await chrome.tabs.query({ url: `${GAME_ORIGIN}/*` });
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: `${GAME_ORIGIN}/` });
  }
}

/** Alarms don't survive a browser restart; re-arm from the stored vaults. */
async function ensureScheduled(): Promise<void> {
  let state = await storage.getRealEstateVaults();
  if (!state?.collections) {
    const collections = await backfillCollections();
    // Re-read: a collection may have landed while the archive was read.
    const latest = await storage.getRealEstateVaults();
    let merged = latest?.collections ?? [];
    for (const c of collections) merged = withCollection(merged, c);
    state = { vaults: latest?.vaults ?? [], notifiedAt: latest?.notifiedAt ?? null, collections: merged };
    await save(state);
  }
  if (!state || state.notifiedAt !== null) return;
  if (await chrome.alarms.get(ALARM_NAMES.REAL_ESTATE_VAULT)) return;
  const alert = vaultAlert(state.vaults);
  if (!alert) return;
  // Already past due (the browser was closed through it): check shortly.
  chrome.alarms.create(ALARM_NAMES.REAL_ESTATE_VAULT, { when: Math.max(alert.at, Date.now() + 30_000) });
}

export function init(): void {
  // Registered synchronously at startup so a click can wake the worker.
  chrome.notifications.onClicked.addListener((id) => {
    handleNotificationClick(id).catch((err) => console.error(LOG_PREFIX, 'vault reminder click failed', err));
  });
  ensureScheduled().catch((err) => console.error(LOG_PREFIX, 'vault reminder ensureScheduled failed', err));
}
