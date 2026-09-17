import { unwrapPanelEnvelope } from '@/shared/panelEnvelope';
import type { AchievementCapstone, AchievementCategory, AchievementLine, AchievementNextTier, AchievementReadyClaim, AchievementTierLabel } from '@/shared/types';

/**
 * DOM-free regex parser for `GET /api/panel.php?ach_ver=v2&ach_cat=<Category>
 * &type=achievements` — same style and same reason as
 * `careerAuto/careersPanelParser.ts`: this runs in the MV3 background
 * service worker, which doesn't reliably have `DOMParser`.
 *
 * Every line is one `<div class="av2-line">` (or `<div class="av2-line
 * ready">` once a further tier is crossed but not yet claimed) — splitting
 * on that isolates each line's markup cleanly since nothing here nests
 * another `.av2-line` inside one.
 *
 * The trickiest real behavior, confirmed against a 2026-09-17 capture: the
 * `.av2-reward`/`.av2-next` block always previews the *upcoming* tier (the
 * one the strip's next unfilled segment represents), never the one that's
 * currently `Ready`. "First Chop" showed `eyebrow: "Ready"` with a
 * `.av2-claim` button paying $1,000,000 + 25 Mafia Gold, while its own
 * `.av2-reward` in the very same chunk previewed $10,000,000 + 100 Gold —
 * the *next* tier after the one that's ready. So the ready reward is read
 * only from the claim button's own text, and the preview reward/progress is
 * always treated as "what's next after whatever's currently claimable,"
 * never conflated with it. See `AchievementReadyClaim`'s own doc.
 */

const TIER_LABELS: ReadonlySet<string> = new Set(['bronze', 'silver', 'gold', 'crown']);

function parseTierLabel(raw: string): AchievementTierLabel {
  const lower = raw.trim().toLowerCase();
  return TIER_LABELS.has(lower) ? (lower as AchievementTierLabel) : 'unproven';
}

function parseLine(chunk: string): AchievementLine | null {
  const nameMatch = chunk.match(/av2-line-t"><span[^>]*>([^<]+)<\/span>/);
  const tierMatch = chunk.match(/class="eyebrow"[^>]*>([^<]+)<\/span>/);
  const descMatch = chunk.match(/<\/div><div style="[^"]*">([^<]+)<\/div>/);
  if (!nameMatch || !tierMatch) return null;

  const rawTier = tierMatch[1].trim();
  const ready = (() => {
    if (rawTier !== 'Ready') return null;
    const claimMatch = chunk.match(/onclick="Av2\.claimLine\(this,'([^']+)'\)">Claim ([^<]+)<\/button>/);
    if (!claimMatch) return null;
    return { lineId: claimMatch[1], rewardText: decodeEntities(claimMatch[2]) } satisfies AchievementReadyClaim;
  })();

  const nextTextMatch = chunk.match(/av2-next"[^>]*>(.*?)<\/div>/);
  let next: AchievementNextTier | null = null;
  let allTiersComplete = false;

  if (nextTextMatch) {
    const progressMatch = nextTextMatch[1].match(/^(.*?)&middot; <b class="n">([\d,]+)<\/b><span[^>]*> \/ ([\d,]+)<\/span>$/);
    if (progressMatch) {
      const rewardMatch = chunk.match(/av2-reward-v n">([^<]+)<\/span><span class="av2-reward-sep">\+<\/span><span class="av2-reward-g n"><i[^>]*><\/i>([^<]+)<\/span>/);
      next = {
        requirementText: decodeEntities(progressMatch[1].trim()),
        current: Number(progressMatch[2].replace(/,/g, '')),
        target: Number(progressMatch[3].replace(/,/g, '')),
        rewardText: rewardMatch ? `${rewardMatch[1]} + ${rewardMatch[2]}` : '',
      };
    } else {
      // No "current / target" shape at all — confirmed real for a line with
      // every tier already claimed (Estate's "Breaking Ground": next-text
      // literally "All four counts proven.", no reward block at all).
      allTiersComplete = true;
    }
  }

  // "Ready" isn't itself a tier name — it overrides whatever the last-
  // claimed tier's own label would have been (see the module doc), and
  // nothing in this markup says what that was, so it falls back to
  // 'unproven' rather than guessing. The `ready` field above is what
  // actually carries the meaningful state in that case.
  const tier: AchievementTierLabel = rawTier === 'Ready' ? 'unproven' : parseTierLabel(rawTier);

  return {
    name: decodeEntities(nameMatch[1].trim()),
    description: descMatch ? decodeEntities(descMatch[1].trim()) : '',
    tier,
    ready,
    next,
    allTiersComplete,
  };
}

function parseCapstone(html: string): AchievementCapstone | null {
  const blockMatch = html.match(/<div class="av2-cap( locked)?">([\s\S]*?)(?=<div class="av2-line)/);
  if (!blockMatch) return null;
  const block = blockMatch[0];

  const nameMatch = block.match(/Capstone<\/div><div[^>]*>([^<]+)<\/div>/);
  const progressMatch = block.match(/class="n"[^>]*>([\d,]+)<span[^>]*>\/([\d,]+)<\/span>/);
  const descMatch = block.match(/<\/div><\/div><div style="[^"]*">([^<]+)<\/div>/);
  const rewardMatch = block.match(/av2-reward-v n">([^<]+)<\/span><span class="av2-reward-sep">\+<\/span><span class="av2-reward-g n"><i[^>]*><\/i>([^<]+)<\/span>/);
  if (!nameMatch || !progressMatch) return null;

  return {
    name: decodeEntities(nameMatch[1].trim()),
    description: descMatch ? decodeEntities(descMatch[1].trim()) : '',
    current: Number(progressMatch[1].replace(/,/g, '')),
    target: Number(progressMatch[2].replace(/,/g, '')),
    rewardCash: rewardMatch ? Number(rewardMatch[1].replace(/[^0-9]/g, '')) : 0,
    rewardGold: rewardMatch ? Number(rewardMatch[2].replace(/[^0-9]/g, '')) : 0,
    locked: !!blockMatch[1],
  };
}

/** Only the handful of entities this page's own copy actually uses
 *  (`&middot;`, `&amp;`, `&#39;`) — not a general-purpose HTML decoder,
 *  since nothing else has shown up in any real capture. */
function decodeEntities(text: string): string {
  return text.replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
}

export function parseAchievementCategory(responseText: string, categoryName: string): AchievementCategory {
  const envelope = unwrapPanelEnvelope(responseText);
  if (!envelope) return { name: categoryName, lines: [], capstone: null };

  const chunks = envelope.html.split(/<div class="av2-line(?: ready)?">/).slice(1);
  const lines = chunks.map(parseLine).filter((l): l is AchievementLine => l != null);

  return { name: categoryName, lines, capstone: parseCapstone(envelope.html) };
}
