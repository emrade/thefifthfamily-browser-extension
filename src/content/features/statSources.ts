import type { CapturedRequest } from '@/shared/messaging';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { panelHtml, parseActivePet, parseEquippedCar, parseGear, parseGym, parseLoadout } from '@/shared/statBreakdown';

/**
 * Keeps Dashboard → Stats current from the pages the player opens: the Gym,
 * the inventory, the Menagerie care tab, the Chop Shop and the Arena's season
 * lock-in. Read-only: it only parses replies the game already sent. The
 * Dashboard's Refresh button reads the same pages from the background
 * (background/features/statSources.ts).
 */
export function handleCapturedRequest(req: CapturedRequest): void {
  if (req.status !== null && req.status !== 200) return;
  let url: URL;
  try {
    url = new URL(req.url, location.origin);
  } catch {
    return;
  }
  const at = req.timestamp ?? Date.now();
  const run = (work: () => Promise<void>) => void work().catch((err) => console.error(LOG_PREFIX, 'stat source capture failed', err));

  if (req.method === 'GET' && url.pathname === '/api/panel.php') {
    const type = url.searchParams.get('type');
    if (type === 'gym') {
      const html = panelHtml(req.responseText);
      const gym = html && parseGym(html, at);
      if (gym) run(() => storage.setStatSourceGym(gym));
    } else if (type === 'inventory') {
      const html = panelHtml(req.responseText);
      const gear = html ? parseGear(html, at) : undefined;
      if (gear) run(() => storage.setStatSourceGear(gear));
    } else if (type === 'menagerie' && url.searchParams.get('men_tab') === 'care') {
      const html = panelHtml(req.responseText);
      const pet = html && parseActivePet(html, at);
      if (pet) run(() => storage.setStatSourcePet(pet));
    }
    return;
  }

  if (req.method !== 'POST') return;
  const action = new URLSearchParams(req.requestBody ?? '').get('action');
  let json: any;
  const parse = () => {
    try {
      return JSON.parse(req.responseText);
    } catch {
      return null;
    }
  };
  if (url.pathname === '/api/chop_shop_proto.php' && action === 'catalog') {
    json = parse();
    const car = json?.ok === true ? parseEquippedCar(json, at) : null;
    if (car) run(() => storage.setStatSourceCar(car));
  } else if (url.pathname === '/actions/arena_v2.php' && action === 'preview_loadout') {
    json = parse();
    const loadout = json?.ok === true ? parseLoadout(json, at) : null;
    if (loadout) run(() => storage.setStatSourceLoadout(loadout));
  }
}
