/**
 * Parses a reward range like `"$149.8k–$262.1k"` or `"$1.31m–$2.29m"` into raw
 * dollar numbers — Street Intel's "$X-$Y" reward figures switched from plain
 * comma-formatted digits (`"$5,500–$13,000"`, confirmed real from an
 * 2026-08-10 capture) to abbreviated k/m notation sometime before 2026-08-15,
 * as part of a broader markup refresh (`window.SI_V2`). Handles both shapes —
 * nothing confirms every reward is always abbreviated (a low enough figure
 * might still render plain) — rather than assuming the new one replaced the
 * old one everywhere.
 *
 * Shared between `streetIntelPanelRegexParser.ts` (background, regex-only) and
 * `pageHighlights.ts` (content, reads the already-extracted `.val` text) since
 * both need the exact same "$X[km]?–$Y[km]?" → numbers conversion.
 */
export function parseDollarRange(text: string): { min: number; max: number } | null {
  const match = text.match(/\$([\d,]+(?:\.\d+)?)\s*(k|m)?\s*[–-]\s*\$([\d,]+(?:\.\d+)?)\s*(k|m)?/i);
  if (!match) return null;
  return { min: parseDollarAmount(match[1], match[2]), max: parseDollarAmount(match[3], match[4]) };
}

function parseDollarAmount(digits: string, suffix: string | undefined): number {
  const n = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const mult = suffix?.toLowerCase() === 'k' ? 1_000 : suffix?.toLowerCase() === 'm' ? 1_000_000 : 1;
  return Math.round(n * mult);
}
