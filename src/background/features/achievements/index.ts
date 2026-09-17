import { GAME_ORIGIN } from '@/shared/constants';
import { loggedFetch } from '@/shared/requestLog/loggedFetch';
import type { AchievementCategory, AchievementClaimResult } from '@/shared/types';
import { postAction } from '../../gameAction';
import { parseAchievementCategory } from './achievementsPanelParser';

/**
 * Backs the per-page Achievement chip — a live, uncached read per category
 * (same reasoning as `careerAuto.fetchCareerCatalog`: this is opened
 * on-demand, and staleness costs more than the round trip), plus the
 * single-line claim action the chip's modal offers once a line is Ready.
 */

/** `ach_cat` takes the category name verbatim, not a slug — confirmed real
 *  from the live panel's own `Game.loadPanel('achievements','','&ach_ver=v2
 *  &ach_cat=' + encodeURIComponent(Av2.cat))` calls. */
export async function fetchCategory(category: string): Promise<AchievementCategory> {
  const url = `${GAME_ORIGIN}/api/panel.php?ach_cat=${encodeURIComponent(category)}&ach_ver=v2&type=achievements&_t=${Date.now()}`;
  const res = await loggedFetch(url, { credentials: 'include' });
  return parseAchievementCategory(await res.text(), category);
}

/** Claims one specific line — see `AchievementClaimResult`'s own doc for why
 *  only `message` is trusted from the response. */
export async function claimLine(lineId: string): Promise<AchievementClaimResult> {
  const resp = await postAction('/actions/achievements_v2.php', { action: 'claim', line_id: lineId });
  if (resp.ok === false) throw new Error(resp.error || `Claiming ${lineId} was rejected.`);
  return { message: resp.message ?? '' };
}
