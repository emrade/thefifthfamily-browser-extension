/**
 * Which of this hour's open routes the couriers go to.
 *
 * The "Send Every Courier" block lists the hour's two routes as
 * `sv2-lo-dest` buttons: `on` is the one the game pre-selected, a plain
 * button is the other one (still selectable), `off` is locked. Each shows
 * its trip time as "N min base".
 *
 * Fastest wins, not the game's default: a courier pays the same per unit
 * wherever it delivers (checked on ~3,000 offloads 2026-10-01 → 10-15, every
 * item's `unit_net` identical across destinations), and a pet is free again
 * the moment it lands (relaunch ≈ landing + 3 min, 4,345 launches), so a
 * shorter trip is simply more deliveries. A pet's speed multiplies every
 * route's base time alike, so the shortest base is the shortest for every
 * pet. On 2026-10-15 the game pre-selected the slower route in 4 of 5 two-
 * route hours (e.g. The Strip 21 min over The Underground 8 min). Sending to
 * the non-default route was confirmed by the player's own send (2026-10-16
 * 12:50 UTC): the page sends the same `v2_launch` fields, only
 * `destination_city_id` differs.
 *
 * If any open route's time can't be read, the pre-selected one is used, as
 * before; a tie also keeps it.
 */
export interface RouteButton {
  cityId: number;
  name: string;
  preselected: boolean;
  /** "N min base", or null when it couldn't be read. */
  baseMinutes: number | null;
}

export function baseMinutesFrom(text: string): number | null {
  const m = text.match(/(\d+)\s*min\s*base/i);
  return m ? Number(m[1]) : null;
}

export function pickRoute(open: RouteButton[]): RouteButton | null {
  const preselected = open.find((r) => r.preselected) ?? null;
  if (open.length < 2 || open.some((r) => r.baseMinutes == null)) return preselected;
  let best = preselected ?? open[0];
  for (const r of open) if ((r.baseMinutes as number) < (best.baseMinutes as number)) best = r;
  return best;
}
