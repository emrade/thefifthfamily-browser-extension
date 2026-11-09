import type { CapturedRequest } from '@/shared/messaging';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import { panelHtml, parseActivePet, parseEquippedCar, parseGear, parseGym, parseLoadout } from '@/shared/statBreakdown';
import { parseAcademy, parseBloodline, parseCareers, parsePetRoster } from '@/shared/statAdvisorSources';

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
      if (pet && html) {
        pet.roster = parsePetRoster(html);
        run(() => storage.setStatSourcePet(pet));
      }
    } else if (type === 'academy') {
      const html = panelHtml(req.responseText);
      const academy = html && parseAcademy(html, at);
      if (academy) run(() => storage.setStatSourceAcademy(academy));
    } else if (type === 'bloodline') {
      const html = panelHtml(req.responseText);
      const bloodline = html && parseBloodline(html, at);
      if (bloodline) run(() => storage.setStatSourceBloodline(bloodline));
    } else if (type === 'careers' && !req.truncated) {
      // The page's own copy is cut at 512 KB when it's that big, which would
      // drop jobs; the Refresh button reads it whole.
      const html = panelHtml(req.responseText);
      const careers = html && parseCareers(html, at);
      if (careers) run(() => storage.setStatSourceCareers(careers));
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
