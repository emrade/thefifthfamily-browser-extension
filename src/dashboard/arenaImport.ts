import { addQuotedFights, type ArenaQuotedFight } from '@/shared/arenaGate';
import { mergeMemory, rememberFight, type ArenaOpponentMemory } from '@/shared/arenaOpponentMemory';
import { storage } from '@/shared/storage';

/**
 * Imports Arena history from HTTP-archive exports (`fifth-family-archive-*`
 * files, gzipped NDJSON) into the extension's own Arena records: the
 * opponent memory and the game-%-vs-result record behind the Safety Gate's
 * suggestions. Needed because the in-extension request archive only holds
 * ~2 days.
 *
 * - Any mix of files: raw exports, merged monthly files, overlapping ones.
 *   Fights are keyed by their capture timestamp, so nothing counts twice,
 *   including fights the extension already recorded live. No merging first.
 * - Streams each file and only parses the Arena lines (fights and Arena
 *   pages), so large files work, just slowly.
 * - A fight's game % comes from the latest Arena page shown before it (any
 *   `type=arena` page variant) with that opponent's card, within 30 minutes.
 *
 * Read-only towards the game: it reads files the player chose, nothing else.
 */

const ATTACK_MARK = '"endpoint":"POST /actions/arena_v2.php"';
const PANEL_MARK = 'type=arena';
const PANEL_ENDPOINT_MARK = '"endpoint":"GET /api/panel.php';
const PAIR_WINDOW_MS = 30 * 60_000;

export interface ArenaImportProgress {
  file: string;
  filesDone: number;
  filesTotal: number;
  fights: number;
}

export interface ArenaImportResult {
  fightsRead: number;
  opponentsBefore: number;
  opponentsAfter: number;
  quotedBefore: number;
  quotedAfter: number;
}

interface Snapshot {
  at: number;
  quoted: Map<string, number>;
}

async function* lines(file: File): AsyncGenerator<string> {
  // The DOM typings disagree on these streams' chunk types (BufferSource vs
  // Uint8Array); at runtime both carry bytes, so they're typed loosely here.
  type ByteStream = ReadableStream<Uint8Array>;
  let stream = file.stream() as unknown as ByteStream;
  if (file.name.endsWith('.gz')) stream = stream.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = stream.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      yield buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  }
  if (buf) yield buf;
}

function readQuotes(html: string): Map<string, number> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = new Map<string, number>();
  for (const el of doc.querySelectorAll('.ar-opp')) {
    if (el.classList.contains('ar-opp-boss')) continue;
    const name = el.querySelector('.ar-opp-name')?.textContent?.trim();
    const pct = Number((el.querySelector('.ar-opp-winpct')?.textContent ?? '').replace(/[^\d.]/g, ''));
    if (name && el.querySelector('.ar-opp-winpct') && Number.isFinite(pct)) out.set(name, pct);
  }
  return out;
}

export async function importArenaExports(files: File[], onProgress: (p: ArenaImportProgress) => void): Promise<ArenaImportResult> {
  let imported: ArenaOpponentMemory = {};
  const fights: { at: number; name: string; won: boolean }[] = [];
  const snapshots: Snapshot[] = [];
  const seenFights = new Set<number>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({ file: file.name, filesDone: i, filesTotal: files.length, fights: fights.length });
    let first = true;
    for await (const line of lines(file)) {
      if (first) {
        first = false; // the export's header line
        continue;
      }
      const isAttack = line.includes(ATTACK_MARK) && line.includes('action=attack');
      const isPanel = !isAttack && line.includes(PANEL_ENDPOINT_MARK) && line.includes(PANEL_MARK);
      if (!isAttack && !isPanel) continue;
      let row: { timestamp?: number; requestBody?: string; responseBody?: string };
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof row.timestamp !== 'number' || !row.responseBody) continue;
      try {
        if (isAttack) {
          if (new URLSearchParams(row.requestBody ?? '').get('opponent_id') === '0') continue;
          if (seenFights.has(row.timestamp)) continue;
          const resp = JSON.parse(row.responseBody);
          if (resp?.ok !== true || typeof resp.defender !== 'string' || typeof resp.won !== 'boolean') continue;
          seenFights.add(row.timestamp);
          imported = rememberFight(imported, resp, row.timestamp);
          fights.push({ at: row.timestamp, name: resp.defender, won: resp.won });
        } else {
          const html = JSON.parse(row.responseBody)?.html;
          if (typeof html !== 'string' || !html.includes('ar-opp')) continue;
          const quoted = readQuotes(html);
          if (quoted.size > 0) snapshots.push({ at: row.timestamp, quoted });
        }
      } catch {
        // A truncated or unreadable row is skipped; the rest still count.
      }
    }
  }
  onProgress({ file: '', filesDone: files.length, filesTotal: files.length, fights: fights.length });

  snapshots.sort((a, b) => a.at - b.at);
  const quotedFights: ArenaQuotedFight[] = [];
  for (const f of fights) {
    for (let k = snapshots.length - 1; k >= 0; k--) {
      const s = snapshots[k];
      if (s.at >= f.at) continue;
      if (f.at - s.at > PAIR_WINDOW_MS) break;
      const q = s.quoted.get(f.name);
      if (q !== undefined) {
        quotedFights.push({ at: f.at, name: f.name, quoted: q, won: f.won });
        break;
      }
    }
  }

  const [memBefore, quoteBefore] = await Promise.all([storage.getArenaOpponentMemory(), storage.getArenaQuoteRecord()]);
  const memAfter = mergeMemory(memBefore, imported);
  const quoteAfter = addQuotedFights(quoteBefore, quotedFights);
  await Promise.all([storage.setArenaOpponentMemory(memAfter), storage.setArenaQuoteRecord(quoteAfter)]);
  return {
    fightsRead: fights.length,
    opponentsBefore: Object.keys(memBefore).length,
    opponentsAfter: Object.keys(memAfter).length,
    quotedBefore: quoteBefore.length,
    quotedAfter: quoteAfter.length,
  };
}
