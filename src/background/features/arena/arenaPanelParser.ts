import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';

/**
 * DOM-free regex parser for `GET /api/panel.php?type=arena` (also seen as
 * `?arena_tab=v2&av2_view=arena&type=arena`) — same reason as every other
 * background-service-worker parser in this codebase: no reliable `DOMParser`
 * there.
 *
 * Everything the automated runner actually *acts* on comes from the JSON
 * action responses themselves (`open_next_page`/`attack`/`bank`), not this
 * HTML — this parser exists only for the two pieces of state the game never
 * puts in JSON at all:
 *
 * - The "Next Page Unlocks In" countdown's real end time
 *   (`parseArenaTimerEnd`) — needed by the *passive* watcher (see
 *   runner.ts), which has to work without ever having called
 *   `open_next_page` itself.
 * - The boss's own attack call, which needs a `page_id` argument
 *   (`parseBossEnginePageId` — see its own doc) that is rendered directly
 *   into the "ENGAGE BOSS" button's `onclick` and appears nowhere in any
 *   JSON response this feature has ever seen, including `open_next_page`'s.
 *
 * Regular-opponent win% *is* readable from this HTML too
 * (`parseOpenOpponents`) — real, rendered "N% CHANCE" text — confirmed
 * identical to `open_next_page`'s own `opponent_bounties[id].win_pct` for
 * the same account/page. Reading it here rather than caching the
 * `open_next_page` response lets the runner re-derive "who's still
 * unfought" from a fresh page load at any point (e.g. resuming a page the
 * player had already started fighting manually before Auto-Attack was
 * turned on), instead of only ever trusting its own prior action responses.
 */

export interface ArenaOpenOpponent {
  id: number;
  winPct: number;
}

/** `data-end` is a Unix **seconds** timestamp, straight off the countdown
 *  element (`id="ar-timer" data-end="1789644989"`) — present on every real
 *  panel load regardless of whether the current page is still being fought
 *  or already closed (it's the *next* page's own unlock time, fixed the
 *  moment the current page opened, not a "are you done yet" flag). Ready to
 *  open the next page is simply `parseArenaTimerEnd(html) <= Date.now()`. */
export function parseArenaTimerEnd(html: string): number | null {
  const match = html.match(/id="ar-timer" data-end="(\d+)"/);
  if (!match) return null;
  return Number(match[1]) * 1000;
}

/** Every still-attackable regular opponent. Splits on the exact literal
 *  `<div class="ar-opp">` — same "split on an exact marker, don't try to
 *  balance nested tags" idiom `achievementsPanelParser.ts` uses for
 *  `<div class="av2-line">`. This marker only ever matches a live, unfought
 *  regular opponent: a defeated one instead renders `class="ar-opp fought"`
 *  (an extra token, so a different literal string) and the boss's own card
 *  is `class="ar-opp ar-opp-boss ..."` (likewise) — neither is split on by
 *  this exact string, so both are naturally excluded rather than needing
 *  their own filter. */
export function parseOpenOpponents(html: string): ArenaOpenOpponent[] {
  const chunks = html.split('<div class="ar-opp">').slice(1);
  const results: ArenaOpenOpponent[] = [];
  for (const chunk of chunks) {
    const idMatch = chunk.match(/class="ar-opp-btn" onclick="av2_arenaAttack\((\d+)\)"/);
    const pctMatch = chunk.match(/class="ar-opp-winpct[^"]*">(\d+)<span class="ar-pts-suffix">% CHANCE<\/span>/);
    if (!idMatch || !pctMatch) continue; // a shape this hasn't seen before — not attackable right now either way
    results.push({ id: Number(idMatch[1]), winPct: Number(pctMatch[1]) });
  }
  return results;
}

/**
 * The boss's own attack call needs a real `page_id` — confirmed real
 * (2026-09-17): every regular-opponent attack this account has ever sent
 * used `page_id=0` (the client-side default when none is passed), but the
 * one captured real boss attack sent `page_id=5338`, which doesn't appear in
 * `open_next_page`'s response, `attack`'s own response for any of the four
 * regular opponents, or anywhere else in JSON — the *only* place it's ever
 * been observed is server-rendered straight into the "ENGAGE BOSS" button's
 * own `onclick="av2_arenaAttack(0,5338)"` once the boss actually unlocks
 * (i.e. once all four regular opponents have been attacked). So this has to
 * be read fresh from a live panel fetch taken after that point — there's no
 * way to know it in advance.
 *
 * Returns `null` both when the boss is still locked (its button instead
 * reads "Locked — Fight All Opponents", confirmed real text, with no
 * `onclick` at all) and when it's already been fought this page (`fought-btn`,
 * "Boss Defeated") — either way, not currently attackable.
 */
export function parseBossEnginePageId(html: string): number | null {
  const match = html.match(/class="ar-opp-btn ar-opp-btn-boss" onclick="av2_arenaAttack\(0,(\d+)\)"/);
  return match ? Number(match[1]) : null;
}

/** The current page's own number, from its section header ("Page 3
 *  Targets") — needed for `bank`'s own `page_number` param, and the only
 *  way to recover it when resuming a page this feature didn't itself open
 *  (see runner.ts's `runAutomationCycle` for when that matters). */
export function parseCurrentPageNumber(html: string): number | null {
  const match = html.match(/<span>Page (\d+) Targets<\/span>/);
  return match ? Number(match[1]) : null;
}

export function unwrapArenaPanelHtml(responseText: string): string | null {
  return unwrapPanelEnvelope(responseText)?.html ?? null;
}
