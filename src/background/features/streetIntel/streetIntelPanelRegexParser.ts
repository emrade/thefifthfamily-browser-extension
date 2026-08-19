import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import { parseDollarRange } from '@/shared/parseDollarRange';

export interface StreetIntelOpportunity {
  id: number;
  title: string;
  riskTier: 'low' | 'medium' | 'high' | 'extreme';
  legendary: boolean;
  rewardMin: number;
  rewardMax: number;
}

/**
 * DOM-free parser for `GET /api/panel.php?type=street_intel`, for use by the
 * background poller — MV3 service workers don't reliably have DOMParser, same
 * reasoning as smugglingHtmlRegexParser.ts. Only extracts what the "notify on a
 * medium-risk-or-better opportunity" check needs — risk tier, title, reward range,
 * and the opportunity's own id (embedded in its card's `onclick="siScout(ID,...)"`,
 * the only stable identifier available; a completed card's markup drops that
 * onclick entirely, which conveniently also excludes it here — nothing to notify
 * about for a job already resolved this cycle).
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

    opportunities.push({
      id: Number(idMatch[1]),
      title: titleMatch ? titleMatch[1].trim() : 'Unknown Opportunity',
      riskTier,
      legendary: classes.includes('legendary'),
      rewardMin: reward?.min ?? 0,
      rewardMax: reward?.max ?? 0,
    });
  }

  return opportunities;
}
