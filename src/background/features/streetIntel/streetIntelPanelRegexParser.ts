import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import { parseDollarRange } from '@/shared/parseDollarRange';

export interface StreetIntelApproach {
  key: string;
  stat: string;
  bonus: number;
  /** True when the game itself has already flagged this approach as an
   *  automatic failure for this account (confirmed real, seen most often on
   *  `fight` for this account's weak Strength) — before ever scouting. Picking
   *  by highest scouted `estimate_pct` naturally avoids these anyway (they
   *  score at/near 0%), so this is exposed for completeness/debugging rather
   *  than as a separate filter the runner has to apply itself. */
  autofail: boolean;
}

export interface StreetIntelOpportunity {
  id: number;
  title: string;
  riskTier: 'low' | 'medium' | 'high' | 'extreme';
  legendary: boolean;
  rewardMin: number;
  rewardMax: number;
  /** The card's own "Stamina" stat — the cost of an `attempt` on it. Present
   *  regardless of whether the card is currently on the shared cooldown
   *  (unlike Career's cooldown state, which drops this from the markup
   *  entirely — see the `disabled`-but-data-intact note below). */
  staminaCost: number;
  /** The Scout button's own separate cost ("Scout (1S)" in its label) —
   *  confirmed 1-2 Stamina, contact-perk dependent, and additional to
   *  `staminaCost` (the attempt's own cost) since scouting happens first. */
  scoutCost: number;
  /** The card's own countdown, independent of the shared account-wide action
   *  cooldown. Null if the card carries no visible timer. */
  expirySeconds: number | null;
  /** From the card's own `data-approaches` attribute — present, and complete,
   *  even while the card's Scout/Go-Blind buttons are `disabled` for being on
   *  the shared cooldown. That's confirmed from a real capture taken while on
   *  cooldown: the button keeps its `onclick`/`data-*` attributes and just
   *  gains `disabled` styling, unlike Career's cooldown state, which replaces
   *  the whole button and loses the data. */
  approaches: StreetIntelApproach[];
}

/** Minimal decode for the handful of HTML entities the game actually uses
 *  inside a `data-*` attribute value (it double-encodes JSON into an HTML
 *  attribute) — not a general-purpose HTML entity decoder. */
function decodeAttrEntities(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
}

/**
 * DOM-free parser for `GET /api/panel.php?type=street_intel`, for use by both
 * the background notifier and the auto-attempt runner — MV3 service workers
 * don't reliably have DOMParser, same reasoning as smugglingHtmlRegexParser.ts.
 */
export function parseStreetIntelOpportunities(responseText: string): StreetIntelOpportunity[] | null {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return null;

  // The panel response appends an Operation Dossier table and a large inline
  // <img onerror="..."> script blob after the opportunity cards. Neither is
  // wanted here, and since split() leaves the *last* card's chunk unbounded
  // (no further "si-card " delimiter to stop at), a title regex that fails to
  // match within that last card's own markup will otherwise keep scanning
  // straight into that trailing blob and pick up JS source as a "title".
  // Cutting the trailing section off first keeps every chunk — including the
  // last — bounded to actual card markup.
  const cardsSectionEnd = envelope.html.indexOf('Operation Dossier');
  const cardsHtml = cardsSectionEnd === -1 ? envelope.html : envelope.html.slice(0, cardsSectionEnd);

  const opportunities: StreetIntelOpportunity[] = [];
  const chunks = cardsHtml.split('<div class="si-card ').slice(1);

  for (const chunk of chunks) {
    // Present (with the full onclick/data-* attributes intact) on a workable
    // card — including one currently `disabled` for being on the shared
    // cooldown. Absent on a level-locked card (`Lv N Required`, no handler at
    // all) and on one already completed this cycle (`Completed`, no handler
    // either) — both are simply "not a candidate right now," no need to tell
    // them apart any further than that.
    const idMatch = chunk.match(/siScout\((\d+),/);
    if (!idMatch) continue;

    const classMatch = chunk.match(/^([^"]*)"/);
    const classes = classMatch ? classMatch[1] : '';

    let riskTier: StreetIntelOpportunity['riskTier'] = 'low';
    if (classes.includes('risk-extreme')) riskTier = 'extreme';
    else if (classes.includes('risk-high')) riskTier = 'high';
    else if (classes.includes('risk-medium')) riskTier = 'medium';

    // Title now sits in a <span> right after the cat-icon div, itself
    // followed by a nested <span> carrying a location subtitle
    // (`<span>Title<span>...location...</span></span>`) — capture stops at
    // the first '<' so it grabs just the title, not the location text.
    const titleMatch = chunk.match(/cat-icon"[\s\S]*?<\/div>\s*<span>([^<]+)/);
    // Captures the whole "$X[km]?–$Y[km]?" text rather than parsing digits
    // inline — the `>\$` anchor is what actually picks out the reward stat
    // specifically (the only `.val` in a card whose content starts with `$`
    // directly; "Part / Crit" also holds dollar figures but nests them inside
    // spans, so the char right after `>` there is `<`, not `$`).
    const rewardMatch = chunk.match(/class="val"[^>]*>(\$[^<]+)</);
    const reward = rewardMatch ? parseDollarRange(rewardMatch[1]) : null;

    const staminaMatch = chunk.match(/class="val"[^>]*>(\d+)<\/div><div class="lbl">Stamina<\/div>/);
    const expiryMatch = chunk.match(/si-timer[^"]*"[^>]*>\s*<span class="countdown" data-seconds="(\d+)"/);
    const scoutCostMatch = chunk.match(/Scout \((\d+)S\)/);

    let approaches: StreetIntelApproach[] = [];
    const approachesMatch = chunk.match(/data-approaches="([^"]+)"/);
    if (approachesMatch) {
      try {
        const parsed = JSON.parse(decodeAttrEntities(approachesMatch[1]));
        if (Array.isArray(parsed)) {
          approaches = parsed.map((a) => ({
            key: String(a.key ?? ''),
            stat: String(a.stat ?? ''),
            bonus: Number(a.bonus) || 0,
            autofail: Boolean(a.autofail),
          }));
        }
      } catch {
        // Malformed data-approaches on an otherwise-valid card — leave
        // approaches empty rather than fail the whole opportunity; a caller
        // that needs approaches (the auto-runner) simply won't find a
        // candidate to scout in this one, same as if it were an empty list.
      }
    }

    opportunities.push({
      id: Number(idMatch[1]),
      title: titleMatch ? decodeAttrEntities(titleMatch[1].trim()) : 'Unknown Opportunity',
      riskTier,
      legendary: classes.includes('legendary'),
      rewardMin: reward?.min ?? 0,
      rewardMax: reward?.max ?? 0,
      staminaCost: staminaMatch ? Number(staminaMatch[1]) : 0,
      scoutCost: scoutCostMatch ? Number(scoutCostMatch[1]) : 1,
      expirySeconds: expiryMatch ? Number(expiryMatch[1]) : null,
      approaches,
    });
  }

  return opportunities;
}

/**
 * The shared, account-wide action cooldown after an `attempt` — confirmed
 * from a real capture to render as `<div class="si-cooldown-bar">...<span
 * class="countdown" data-seconds="N">...`, present only while actually on
 * cooldown (a fresh fetch after it elapses omits the bar entirely). This is
 * the cross-check source of truth for "are we really off cooldown" — the
 * runner's own tracked `nextEligibleAt` can go stale if the same account also
 * plays manually in-game.
 */
export function parseSharedCooldownSeconds(responseText: string): number | null {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return null;

  const match = envelope.html.match(/si-cooldown-bar"[\s\S]*?data-seconds="(\d+)"/);
  return match ? Number(match[1]) : null;
}
