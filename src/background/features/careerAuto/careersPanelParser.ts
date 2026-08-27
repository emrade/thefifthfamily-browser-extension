import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import type { CareerCatalogEntry } from '@/shared/types';

/**
 * DOM-free regex parser for `GET /api/panel.php?type=careers`, same style and
 * same reason as `tradeAssistant/smugglingV2RegexParser.ts` — this runs in the
 * MV3 background service worker, which doesn't reliably have `DOMParser`.
 *
 * Every job is rendered as one `<div class="cv2-card" id="career-card-<id>" ...>`
 * — splitting on that id attribute isolates each card's markup with no need to
 * balance tags, exactly like the black-market grid's `.sv2-card` cards.
 *
 * A job's action button is actually one of *three* different variants,
 * confirmed against real captures, not assumed:
 * - Workable now: `<button class="work-btn cv2-work-btn" data-cost="N" ...
 *   onclick="Game.doCareer(id)">`, plus a sibling `cv2-ot-btn` with its own
 *   `data-cost` once the job has reached rank 2 (a never-worked job's card has
 *   only the normal button — no `cv2-ot-btn` at all below rank 2).
 * - Level-gated (player level below the job's requirement): `<button
 *   class="cv2-work-btn" disabled>...Lv N Required</button>` — no `onclick`, no
 *   `data-cost`, no id in it at all.
 * - **On cooldown** (confirmed from a real capture taken 2 seconds after this
 *   account's own `career.php` call): the button row is replaced *entirely* by
 *   `<button class="cooldown-btn"><span class="countdown" ...>04:58</span></button>`
 *   — no `onclick`, no `data-cost`, nothing distinguishing it from the
 *   level-gated case by button markup alone. A job on cooldown is exactly a job
 *   this feature has to pick from (it's the account's *own* selected job,
 *   immediately after every shift it runs) — so "has a `doCareer` handler right
 *   now" is the wrong signal for "is this a legitimate choice", and using it
 *   made a job vanish from the picker the instant it went on cooldown.
 *
 * Level-locked is instead detected from the fixed "Lv N Required" copy that
 * only that state renders, and energy costs are read from the stat tiles/OT
 * summary row that stay present in the card regardless of which button variant
 * is showing, rather than from the (sometimes-absent) button attributes.
 */
export function parseCareersCatalog(responseText: string): CareerCatalogEntry[] {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return [];

  // Keyed by careerId, not pushed to an array directly — a worked job (like the
  // account's own "Recent" pick) is rendered twice: once in its own "Recent"
  // section, once again under its family's tab. Both copies are identical, so
  // the first one seen wins rather than showing the same job twice in a picker.
  const byId = new Map<number, CareerCatalogEntry>();
  const chunks = envelope.html.split('id="career-card-').slice(1);

  for (const chunk of chunks) {
    const idMatch = chunk.match(/^(\d+)"/);
    if (!idMatch) continue;
    const careerId = Number(idMatch[1]);
    if (byId.has(careerId)) continue;

    if (/Lv \d+ Required/.test(chunk)) continue; // level-locked — not a real choice

    const nameMatch = chunk.match(/cv2-card-name">([^<]+)</);
    if (!nameMatch) continue;

    const energyMatch = chunk.match(/cv2-stat-val[^>]*>(\d+)<\/div><div class="cv2-stat-lbl">Energy<\/div>/);
    if (!energyMatch) continue;

    // `cv2-ot-row` is *not* the rank-2 gate it looks like — a real capture
    // (2026-08-27) showed it rendering on every job's card as a cost/reward
    // preview regardless of rank, including a never-worked, "Unranked" job.
    // Trusting it as `otAvailable` sent a rank-1 job's shift with
    // `overtime=1` and got it rejected: "Overtime unlocks at Rank 2." The
    // actual rank-2 gate is `cv2-ot-btn` — the clickable button itself, which
    // only exists as the Work button's sibling once Rank Rewards show R2
    // unlocked (see `isCareerOvertimeUnlocked` below for the live per-cycle
    // version of this same check). The preview row is still the right place
    // to read the energy cost from, since it's present — and accurate —
    // before the job ever reaches rank 2.
    const otMatch = chunk.match(/cv2-ot-row">[\s\S]*?OT:\s*(\d+)E/);

    byId.set(careerId, {
      careerId,
      name: nameMatch[1].trim(),
      energyCost: Number(energyMatch[1]),
      otEnergyCost: otMatch ? Number(otMatch[1]) : null,
      otAvailable: chunk.includes('cv2-ot-btn'),
    });
  }

  return [...byId.values()];
}

/**
 * The account-wide "on break" cooldown after any career shift — confirmed
 * from a real capture (2026-08-26) to render identically on *every* job
 * card while active: `<button class="cooldown-btn"><span class="countdown"
 * data-seconds="258">...`. Not a per-job cooldown (every card shown the same
 * `data-seconds` figure simultaneously) — this is the same account-wide
 * "on break" state the game's own UI message names, distinct from any one
 * job's own selection.
 *
 * This exists as the live cross-check `runner.ts` was missing: it previously
 * fired a shift purely off its own tracked `nextEligibleAt`, which goes
 * stale the same way Street Intel's own tracked cooldown can (manual play,
 * a missed status update) — and the first real instance of that surfaced as
 * a `career.php` rejection ("On break! Wait 3m 20s") that got misread as an
 * unrecognized response shape and paused the whole automation. Same
 * "fetch the panel, trust its live state over what's internally tracked"
 * pattern as `parseSharedCooldownSeconds` in
 * `streetIntel/streetIntelPanelRegexParser.ts`.
 */
export function parseCareerCooldownSeconds(responseText: string): number | null {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return null;

  const match = envelope.html.match(/cooldown-btn"><span class="countdown" data-seconds="(\d+)"/);
  return match ? Number(match[1]) : null;
}

/**
 * Live per-cycle check for whether Overtime is actually clickable for one
 * specific career right now — reads the same `panel.php?type=careers` fetch
 * `runner.ts` already makes every cycle for `parseCareerCooldownSeconds`'s
 * cooldown cross-check, rather than trusting `CareerAutoConfig.otAvailable`,
 * which is only ever captured once at job-selection time (see that field's
 * doc comment in `shared/types.ts`, and `parseCareersCatalog`'s note above on
 * why its own `otAvailable` read was wrong until 2026-08-27).
 *
 * Correctly reads `false` for a job currently on the shared "on break"
 * cooldown, since neither button renders at all then (see the cooldown case
 * in this file's top doc comment) — not a concern for `runner.ts`'s caller,
 * which only reaches this check after already confirming via
 * `parseCareerCooldownSeconds` that the job isn't on cooldown this cycle.
 */
export function isCareerOvertimeUnlocked(responseText: string, careerId: number): boolean {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return false;

  const chunks = envelope.html.split('id="career-card-').slice(1);
  for (const chunk of chunks) {
    const idMatch = chunk.match(/^(\d+)"/);
    if (!idMatch || Number(idMatch[1]) !== careerId) continue;
    return chunk.includes('cv2-ot-btn');
  }
  return false;
}
