import type { RealEstateVault } from './types';

/**
 * The Real Estate vault reminder's pure half: reading each owned property's
 * vault from the Properties panel, and working out when enough of them will
 * be full to be worth a notification. Regex rather than DOM so the
 * background worker (no `DOMParser`) can parse its own confirm read too,
 * the same choice as arena/arenaPanelParser.ts.
 *
 * What the archive shows (2026-10-01 → 10-14, 68 `type=properties` reads):
 * the card's "Vault $X / $CAP" is the live amount, growing by one hour of
 * Hourly Income per full hour since that property's last collection (10.4h
 * after a Collect All, the Fight Club held exactly 10 × its hourly), and
 * stopping at the cap. Overflow past the cap is simply lost: 1% of all
 * income from 2026-09-20 to 10-14, almost all of it in four overnight gaps
 * of 17–21h.
 */

/** Notify once the properties already full earn at least this share of the
 *  portfolio's hourly income. Keeps a tiny early filler (the Downtown Dive
 *  Bar fills in ~6h at $1,196/h, 0.2% of income) from triggering it, while
 *  the first big one (Underground Fight Club, ~14h, 17%) does. */
export const VAULT_ALERT_INCOME_SHARE = 0.1;

const CARD_SPLIT = /<div class="rev2-card owned/;

function money(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function decode(s: string): string {
  return s
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Every owned property card on a Properties panel. A card missing any of
 *  the four numbers is skipped rather than guessed. */
export function parsePropertyVaults(html: string): Omit<RealEstateVault, 'at'>[] {
  const out: Omit<RealEstateVault, 'at'>[] = [];
  for (const card of html.split(CARD_SPLIT).slice(1)) {
    const name = card.match(/class="rev2-card-title">([^<]+)</)?.[1];
    const hourly = money(card.match(/class="rev2-stat-v g">\$([\d,]+)/)?.[1]);
    const cap = money(card.match(/class="rev2-stat-v b">\$([\d,]+)/)?.[1]);
    const vault = money(card.match(/class="rev2-vault-row">\s*<span>Vault<\/span>\s*<span>\s*<span class="n">\$([\d,]+)/)?.[1]);
    if (!name || !hourly || !cap || vault === null) continue;
    const id = Number(card.match(/Rev2\.collect\((\d+)\)/)?.[1]);
    out.push({ key: Number.isFinite(id) && id > 0 ? String(id) : decode(name), name: decode(name), hourly, cap, vault });
  }
  return out;
}

/** The panel endpoint wraps its HTML as `{"html": "..."}`. */
export function unwrapPanelHtml(responseText: string): string | null {
  try {
    const html = JSON.parse(responseText)?.html;
    return typeof html === 'string' ? html : null;
  } catch {
    return null;
  }
}

/** When this property's vault reaches its cap, from what it held at `at`. */
export function fullAt(p: RealEstateVault): number {
  return p.at + (Math.max(0, p.cap - p.vault) / p.hourly) * 3_600_000;
}

export interface VaultAlert {
  /** When the full vaults first reach `VAULT_ALERT_INCOME_SHARE` of income. */
  at: number;
  /** Full by then, biggest earner first. */
  full: RealEstateVault[];
  /** Income going to waste per hour at that point. */
  wastedPerHour: number;
  /** The next property to fill after that, if any. */
  next: RealEstateVault | null;
}

export function vaultAlert(vaults: RealEstateVault[]): VaultAlert | null {
  const total = vaults.reduce((s, p) => s + p.hourly, 0);
  if (total <= 0) return null;
  const byFill = [...vaults].sort((a, b) => fullAt(a) - fullAt(b));
  let wasted = 0;
  for (let i = 0; i < byFill.length; i++) {
    wasted += byFill[i].hourly;
    if (wasted / total >= VAULT_ALERT_INCOME_SHARE) {
      return {
        at: fullAt(byFill[i]),
        full: byFill.slice(0, i + 1).sort((a, b) => b.hourly - a.hourly),
        wastedPerHour: wasted,
        next: byFill[i + 1] ?? null,
      };
    }
  }
  return null;
}

/**
 * Hours since the vaults were last emptied, as of `now`: what each vault
 * holds over its hourly income, aged from when it was read, and the longest
 * of those. A vault grows by whole hours of income, so this reads up to an
 * hour short. A full vault only proves its own fill time had passed, which
 * is still a lower bound. `null` with no vaults to go by.
 */
export function hoursSinceCollected(vaults: RealEstateVault[], now = Date.now()): number | null {
  let best: number | null = null;
  for (const p of vaults) {
    if (p.hourly <= 0) continue;
    const h = Math.min(p.vault, p.cap) / p.hourly + Math.max(0, now - p.at) / 3_600_000;
    if (best === null || h > best) best = h;
  }
  return best;
}
