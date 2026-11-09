import { GAME_ORIGIN } from '@/shared/constants';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import { panelHtml, parseActivePet, parseEquippedCar, parseGear, parseGym } from '@/shared/statBreakdown';
import { postAction } from '../gameAction';
import { getCsrfToken } from '../csrfToken';

/**
 * Dashboard → Stats' Refresh button: reads the four pages the stat breakdown
 * needs, once, when the player presses it. Nothing here runs on a timer.
 *
 * All four are reads the game's own client makes when the player opens those
 * pages, with the same URLs (checked in the archive, 2026-11-09):
 * `panel.php?type=gym`, `panel.php?type=inventory`,
 * `panel.php?type=menagerie&men_tab=care`, and `chop_shop_proto.php
 * action=catalog` (already sent the same way by the Garage feature). The Arena
 * lock-in (`preview_loadout`) is deliberately not requested: the game sends it
 * once a season, so it's only ever captured from the page.
 */

export type StatSourceName = 'gym' | 'gear' | 'pet' | 'car';

export interface StatRefreshResult {
  /** Per source: null when it was read and stored, otherwise why not. */
  errors: Partial<Record<StatSourceName, string>>;
}

async function readPanel(query: string): Promise<string> {
  const res = await loggedFetch(`${GAME_ORIGIN}/api/panel.php?${query}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`the game answered ${res.status}`);
  const html = panelHtml(await res.text());
  if (html === null) throw new Error('the page came back in an unexpected format');
  return html;
}

const PAUSE_MS = 700;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function refreshStatSources(): Promise<StatRefreshResult> {
  const errors: StatRefreshResult['errors'] = {};
  const step = async (name: StatSourceName, work: () => Promise<string | null>) => {
    try {
      const problem = await work();
      if (problem) errors[name] = problem;
    } catch (err) {
      console.error(LOG_PREFIX, `stats refresh: ${name} failed`, err);
      errors[name] = err instanceof Error ? err.message : String(err);
    }
    await sleep(PAUSE_MS);
  };

  await step('gym', async () => {
    const gym = parseGym(await readPanel('type=gym'), Date.now());
    if (!gym) return "couldn't find the stat totals on the Gym page";
    await storage.setStatSourceGym(gym);
    return null;
  });
  await step('gear', async () => {
    const gear = parseGear(await readPanel('type=inventory'), Date.now());
    if (!gear) return "couldn't read the equipped items on the inventory page";
    await storage.setStatSourceGear(gear);
    return null;
  });
  await step('pet', async () => {
    const html = await readPanel('type=menagerie&men_tab=care');
    const pet = parseActivePet(html, Date.now());
    if (!pet) {
      // Say which tab came back, so a wrong tab reads differently from a
      // changed page.
      const tab = /class="men-tab[^"]*\bmen-on\b[^"]*"[^>]*data-tab="men:(\w+)"/.exec(html)?.[1];
      return tab && tab !== 'care' ? `the game returned the Menagerie ${tab} tab instead of Care` : "couldn't find an active pet on the Menagerie care tab";
    }
    await storage.setStatSourcePet(pet);
    return null;
  });
  await step('car', async () => {
    // The catalog is a POST, which needs the game's token. The extension
    // learns it from the game's own requests, so right after the extension
    // (re)loads there may be none yet: ask the player rather than send a
    // request bound to be refused.
    if (!(await getCsrfToken())) return 'needs the game open: click anything there, then Refresh';
    const resp = await postAction('/api/chop_shop_proto.php', { action: 'catalog' });
    if (resp?.ok !== true) return typeof resp?.error === 'string' ? resp.error : 'the Chop Shop refused the read';
    const car = parseEquippedCar(resp, Date.now());
    if (!car) return 'no equipped car in the Chop Shop';
    await storage.setStatSourceCar(car);
    return null;
  });
  return { errors };
}
