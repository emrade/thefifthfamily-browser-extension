/**
 * What the player has learned about each regular Arena opponent from their
 * own fights: the record against them, and the numbers the combat log shows
 * that the card doesn't. Above all, the opponent's real armour.
 *
 * Why it matters (docs/proposals/arena-advisor-post-patch-review.md):
 * - Real armour runs 0.90–1.67× card DEF, because gear adds armour the card
 *   doesn't show.
 * - An opponent's armour is fixed fight to fight. It moved only at the Oct 30
 *   patch or when they changed gear, across 26 opponents met more than once.
 * - 60% of post-patch fights were rematches.
 * - NehNehPok (card DEF 930, real armour 1,088) was rated Beatable three
 *   times and won all three; from the second fight on, this memory has the
 *   real number.
 *
 * Kept in `chrome.storage.local`, separate from the request archive (which
 * only holds ~2 days). Filled from three places, all de-duplicated by the
 * fight's capture timestamp:
 * - every regular `attack` response, live, whatever the page setting;
 * - a one-time seed from the request archive
 *   (background/features/arena/opponentMemoryBackfill.ts);
 * - an import of archive exports on the Dashboard's Arena section.
 */

export interface ArenaOpponentFight {
  /** Capture timestamp of the `attack` request: the same value the archive
   *  stores, so a fight seen live and again in an import counts once. */
  at: number;
  won: boolean;
  /** The player's max HP in that fight (`att_max_hp`); kept for analysis.
   *  Seasons are told apart by date (shared/arenaSeason.ts), not by this:
   *  HP only changes when the player's stats do. */
  myHp?: number;
}

export interface ArenaOpponentRecord {
  name: string;
  /** Up to `ARENA_OPPONENT_HISTORY_MAX` fights, oldest first. */
  history: ArenaOpponentFight[];
  /** The latest fight's numbers. */
  lastAt: number;
  lastWon: boolean;
  /** Median `reduction` on the player's hits in the latest fight: the
   *  opponent's real armour. */
  armour: number | null;
  /** `def_max_hp` from the latest fight. */
  maxHp: number | null;
  /** HP left on the winning side of the latest fight: the player's when
   *  they won, the opponent's when the player lost. */
  lastHpLeft: number | null;
  lastRounds: number;
}

export type ArenaOpponentMemory = Record<string, ArenaOpponentRecord>;

/** Opponents kept, most recently fought first. */
export const ARENA_OPPONENT_MEMORY_MAX = 400;
/** Fights kept per opponent (enough for the record line). */
export const ARENA_OPPONENT_HISTORY_MAX = 50;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function capOpponents(m: ArenaOpponentMemory): ArenaOpponentMemory {
  const names = Object.keys(m);
  if (names.length <= ARENA_OPPONENT_MEMORY_MAX) return m;
  const keep = names.sort((a, b) => m[b].lastAt - m[a].lastAt).slice(0, ARENA_OPPONENT_MEMORY_MAX);
  return Object.fromEntries(keep.map((n) => [n, m[n]]));
}

function mergeHistory(a: ArenaOpponentFight[], b: ArenaOpponentFight[]): ArenaOpponentFight[] {
  const byAt = new Map<number, ArenaOpponentFight>();
  // The same fight from two sources: keep whichever knows the player's HP.
  for (const f of [...a, ...b]) {
    const seen = byAt.get(f.at);
    if (!seen || (seen.myHp === undefined && f.myHp !== undefined)) byAt.set(f.at, f);
  }
  return [...byAt.values()].sort((x, y) => x.at - y.at).slice(-ARENA_OPPONENT_HISTORY_MAX);
}

/**
 * Folds one `attack` response, captured at `at`, into the memory. Returns
 * the same object when there's nothing to add (a boss, `ok:false`,
 * malformed, or a fight already counted), so callers can skip the write.
 */
export function rememberFight(prev: ArenaOpponentMemory, resp: unknown, at: number): ArenaOpponentMemory {
  const r = resp as {
    ok?: unknown;
    won?: unknown;
    defender?: unknown;
    def_max_hp?: unknown;
    attacker_hp_left?: unknown;
    defender_hp_left?: unknown;
    att_max_hp?: unknown;
    rounds?: unknown;
  };
  if (r?.ok !== true || typeof r.won !== 'boolean' || typeof r.defender !== 'string' || !Array.isArray(r.rounds)) return prev;
  const old = prev[r.defender];
  if (old?.history.some((f) => f.at === at)) return prev;
  const reductions: number[] = [];
  for (const round of r.rounds as Record<string, unknown>[]) {
    const a = round?.attacker as { reduction?: unknown } | undefined;
    if (a && typeof a.reduction === 'number' && a.reduction > 0) reductions.push(a.reduction);
  }
  const fight: ArenaOpponentFight = { at, won: r.won, ...(typeof r.att_max_hp === 'number' ? { myHp: r.att_max_hp } : {}) };
  const history = mergeHistory(old?.history ?? [], [fight]);
  const isLatest = !old || at > old.lastAt;
  const record: ArenaOpponentRecord = isLatest
    ? {
        name: r.defender,
        history,
        lastAt: at,
        lastWon: r.won,
        armour: median(reductions) ?? old?.armour ?? null,
        maxHp: typeof r.def_max_hp === 'number' ? r.def_max_hp : old?.maxHp ?? null,
        lastHpLeft: r.won
          ? typeof r.attacker_hp_left === 'number' ? r.attacker_hp_left : null
          : typeof r.defender_hp_left === 'number' ? r.defender_hp_left : null,
        lastRounds: r.rounds.length,
      }
    : // An older fight (from an import) only adds to the record.
      { ...old!, history };
  return capOpponents({ ...prev, [r.defender]: record });
}

/** Combines two memories (e.g. stored + imported): histories are joined
 *  without double-counting; the latest fight's numbers win. */
export function mergeMemory(a: ArenaOpponentMemory, b: ArenaOpponentMemory): ArenaOpponentMemory {
  const out: ArenaOpponentMemory = { ...a };
  for (const [name, rb] of Object.entries(b)) {
    const ra = out[name];
    if (!ra) {
      out[name] = rb;
      continue;
    }
    const newer = rb.lastAt > ra.lastAt ? rb : ra;
    out[name] = { ...newer, history: mergeHistory(ra.history, rb.history) };
  }
  return capOpponents(out);
}

/** Older stored records (before `history` existed) read as one-fight records. */
export function normaliseMemory(m: ArenaOpponentMemory | null | undefined): ArenaOpponentMemory {
  const out: ArenaOpponentMemory = {};
  for (const [name, r] of Object.entries(m ?? {})) {
    out[name] = Array.isArray(r.history) ? r : { ...r, history: [{ at: r.lastAt, won: r.lastWon }] };
  }
  return out;
}

const tally = (fs: ArenaOpponentFight[]) => {
  const wins = fs.filter((f) => f.won).length;
  return `${wins}–${fs.length - wins}`;
};

/**
 * The record line, e.g. "0–3 this season (2–4 all-time) · they finished on
 * 148 HP".
 *
 * Fights from `seasonStart` on (the game's own season boundary,
 * shared/arenaSeason.ts) count as this season. An earlier season's results
 * came from different stats on both sides, so they're shown apart rather
 * than mixed in. Without a season start, the plain all-time record is shown.
 */
export function memoryText(rec: ArenaOpponentRecord, seasonStart: number | null = null): string {
  const all = rec.history;
  const known = seasonStart !== null;
  const season = known ? all.filter((f) => f.at >= seasonStart) : all;
  let record: string;
  if (!known || season.length === all.length) {
    record = all.length <= 1 ? (rec.lastWon ? 'Won last time' : 'Lost last time') : `${tally(all)} vs them`;
  } else if (season.length === 0) {
    record = `Not fought this season (${tally(all)} all-time)`;
  } else {
    record = `${tally(season)} this season (${tally(all)} all-time)`;
  }
  if (rec.lastHpLeft === null) return record;
  // The last fight's ending, labelled when it was in an earlier season.
  const lastIsOld = known && rec.lastAt < seasonStart;
  const when = lastIsOld ? 'last time (earlier season), ' : '';
  return rec.lastWon ? `${record} · ${when}you finished on ${rec.lastHpLeft} HP` : `${record} · ${when}they finished on ${rec.lastHpLeft} HP`;
}
