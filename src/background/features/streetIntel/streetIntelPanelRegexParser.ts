import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';

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

  const opportunities: StreetIntelOpportunity[] = [];
  const chunks = envelope.html.split('<div class="si-card ').slice(1);

  for (const chunk of chunks) {
    const idMatch = chunk.match(/siScout\((\d+),/);
    if (!idMatch) continue;

    const classMatch = chunk.match(/^([^"]*)"/);
    const classes = classMatch ? classMatch[1] : '';

    let riskTier: StreetIntelOpportunity['riskTier'] = 'low';
    if (classes.includes('risk-extreme')) riskTier = 'extreme';
    else if (classes.includes('risk-high')) riskTier = 'high';
    else if (classes.includes('risk-medium')) riskTier = 'medium';

    const titleMatch = chunk.match(/cat-icon"[\s\S]*?<\/div>([^<]+)<\/div>/);
    const rewardMatch = chunk.match(/class="val"[^>]*>\$([\d,]+)\s*[–-]\s*\$([\d,]+)/);

    opportunities.push({
      id: Number(idMatch[1]),
      title: titleMatch ? titleMatch[1].trim() : 'Unknown Opportunity',
      riskTier,
      legendary: classes.includes('legendary'),
      rewardMin: rewardMatch ? Number(rewardMatch[1].replace(/,/g, '')) : 0,
      rewardMax: rewardMatch ? Number(rewardMatch[2].replace(/,/g, '')) : 0,
    });
  }

  return opportunities;
}
