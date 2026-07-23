import { db } from '@/shared/db';

export interface RiskDatabaseRow {
  item: string;
  encounters: number;
  actualCatchRatePct: number;
  avgDisplayedRiskPct: number;
  /** actual − displayed. Positive means the game's gauge is understating real risk
   * for this item; negative means it's overstating it. */
  deltaPct: number;
  bribedCount: number;
  avgBribe: number | null;
}

/**
 * The PRD's item 6 in literal form: per-item actual catch rate vs. the game's
 * displayed risk gauge, built from this account's own CustomsEvent history. Items
 * with fewer than MIN_ENCOUNTERS are still shown (nothing to hide), just with an
 * inherently noisier percentage — the UI should make that clear rather than this
 * function silently dropping low-sample rows.
 */
export async function computeRiskDatabase(): Promise<RiskDatabaseRow[]> {
  const events = await db.customsEvents.toArray();
  if (events.length === 0) return [];

  const byItem = new Map<string, typeof events>();
  for (const e of events) {
    const key = e.item ?? 'Unknown item';
    const list = byItem.get(key) ?? [];
    list.push(e);
    byItem.set(key, list);
  }

  const rows: RiskDatabaseRow[] = [];
  for (const [item, itemEvents] of byItem) {
    const encounters = itemEvents.length;
    const caught = itemEvents.filter((e) => e.caught).length;
    const actualCatchRatePct = (caught / encounters) * 100;

    const withDisplayedRisk = itemEvents.filter((e) => e.displayedRisk !== null);
    const avgDisplayedRiskPct = withDisplayedRisk.length > 0
      ? withDisplayedRisk.reduce((sum, e) => sum + (e.displayedRisk as number), 0) / withDisplayedRisk.length
      : 0;

    const bribed = itemEvents.filter((e) => e.resolution === 'bribe');
    const avgBribe = bribed.length > 0 ? bribed.reduce((sum, e) => sum + e.bribe, 0) / bribed.length : null;

    rows.push({
      item,
      encounters,
      actualCatchRatePct,
      avgDisplayedRiskPct,
      deltaPct: actualCatchRatePct - avgDisplayedRiskPct,
      bribedCount: bribed.length,
      avgBribe,
    });
  }

  return rows.sort((a, b) => b.encounters - a.encounters);
}
