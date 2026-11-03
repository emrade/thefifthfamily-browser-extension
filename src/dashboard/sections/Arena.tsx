import { useEffect, useState } from 'preact/hooks';
import { STORAGE_KEYS } from '@/shared/constants';
import { storage } from '@/shared/storage';
import { ARENA_GATE_MIN_FIGHTS, DEFAULT_ARENA_GATE_CONFIG, suggestGate, type ArenaGateBand, type ArenaGateConfig, type ArenaGateGap, type ArenaQuotedFight } from '@/shared/arenaGate';
import { memoryText, type ArenaOpponentMemory } from '@/shared/arenaOpponentMemory';
import { currentSeasonStart } from '@/shared/arenaSeason';
import type { PageFeaturePreferences } from '@/shared/pageFeatures';
import { PageFeatureSettings } from '../../popup/views/PageFeatureSettings';
import { NotificationSettings } from '../../popup/views/NotificationSettings';
import { NumberInput } from '../../popup/views/NumberInput';
import { importArenaExports, type ArenaImportProgress, type ArenaImportResult } from '../arenaImport';

/**
 * Dashboard → Arena: the Game % Safety Gate's cut-offs with suggestions from
 * the player's own fights (Street Intel style: suggested, never applied
 * without a click), the opponent memory, and the import of archive exports
 * that fills both. Every Arena on/off switch (page features and the Arena
 * notification) is shown at the top too, so they're all in one place; they
 * also stay in Settings, the same stored values in both.
 */

function useStored<T>(key: string, read: () => Promise<T>, initial: T): T {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    void read().then(setV);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && key in changes) void read().then(setV);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return v;
}

const day = (t: number) => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
const gapText = (g: ArenaGateGap) => (g.from === g.to ? `at ${g.from}%` : `between ${g.from}% and ${g.to}%`);
const pct = (b: ArenaGateBand) => (b.fights ? `${Math.round((b.wins / b.fights) * 100)}%` : '—');

function toDateInput(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function GateCard({ config, record, prefs }: { config: ArenaGateConfig; record: ArenaQuotedFight[]; prefs: PageFeaturePreferences | null }) {
  const s = suggestGate(record, config);
  const save = (patch: Partial<ArenaGateConfig>) => void storage.setArenaGateConfig({ ...config, ...patch });
  const needMore = (b: ArenaGateBand) => Math.max(0, ARENA_GATE_MIN_FIGHTS - b.fights);

  return (
    <section class="db-card">
      <h2 class="db-h">Game % Safety Gate</h2>
      <p class="db-p">
        {prefs?.arenaGamePctGate ? 'On.' : 'Off — switch it on under Arena settings above.'} A regular opponent is Beatable only when the
        game’s % is at least the first number, and Avoid below the second.
      </p>
      <div class="db-fields">
        <label class="db-field">
          <span>Beatable from</span>
          <NumberInput class="db-input" value={config.beatableFrom} min={1} max={100} onCommit={(n) => save({ beatableFrom: Math.min(100, Math.max(1, Math.round(n))) })} />
          <span>%</span>
        </label>
        <label class="db-field">
          <span>Avoid below</span>
          <NumberInput class="db-input" value={config.avoidBelow} min={0} max={100} onCommit={(n) => save({ avoidBelow: Math.min(100, Math.max(0, Math.round(n))) })} />
          <span>%</span>
        </label>
        <label class="db-field">
          <span>Count fights since</span>
          <input
            class="db-input db-input--date"
            type="date"
            value={toDateInput(config.since)}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (v) save({ since: new Date(`${v}T00:00:00`).getTime() });
            }}
          />
        </label>
      </div>

      <div class="db-subh">Your record since {day(config.since)} ({s.fights} fights with the game’s %)</div>
      <ul class="db-plain">
        <li>
          Game {config.beatableFrom}% or more: won {s.current.beatable.wins} of {s.current.beatable.fights} ({pct(s.current.beatable)})
        </li>
        <li>
          Game under {config.avoidBelow}%: won {s.current.avoid.wins} of {s.current.avoid.fights} ({pct(s.current.avoid)})
        </li>
      </ul>

      {s.lossesAboveBeatable.length > 0 && (
        <p class="db-warn">
          {s.lossesAboveBeatable.length === 1 ? 'A loss' : `${s.lossesAboveBeatable.length} losses`} at game {config.beatableFrom}%+:{' '}
          {s.lossesAboveBeatable.map((f) => `${f.name} (${f.quoted}%, ${day(f.at)})`).join(', ')}. If this keeps happening, the game may have changed
          its % again: move “Count fights since” to the change and let the suggestions re-settle.
        </p>
      )}

      <div class="db-subh">Suggestions</div>
      <ul class="db-plain">
        <li>
          {s.beatable ? (
            <>
              Beatable from <b>{s.beatable.cutoff}%</b>: won all {s.beatable.fights} fights at {s.beatable.cutoff}% or more.{' '}
              {s.beatable.cutoff !== config.beatableFrom && (
                <button class="db-btn" onClick={() => save({ beatableFrom: s.beatable!.cutoff })}>
                  Apply
                </button>
              )}
              {s.beatable.cutoff === config.beatableFrom && <span class="db-muted">(current)</span>}
              {s.beatableUntested && (
                <div class="db-muted">
                  No fights quoted {gapText(s.beatableUntested)} yet, so the data can't say whether a lower cut-off is safe.
                </div>
              )}
            </>
          ) : (
            <span class="db-muted">
              Beatable: not enough fights yet: needs {ARENA_GATE_MIN_FIGHTS} at one cut-off, all won (now {s.current.beatable.fights} at{' '}
              {config.beatableFrom}%+, {s.current.beatable.fights - s.current.beatable.wins} lost
              {needMore(s.current.beatable) ? `; ${needMore(s.current.beatable)} more needed` : ''}).
            </span>
          )}
        </li>
        <li>
          {s.avoid ? (
            <>
              Avoid below <b>{s.avoid.cutoff}%</b>: won {s.avoid.wins} of {s.avoid.fights} below it.{' '}
              {s.avoid.cutoff !== config.avoidBelow && (
                <button class="db-btn" onClick={() => save({ avoidBelow: s.avoid!.cutoff })}>
                  Apply
                </button>
              )}
              {s.avoid.cutoff === config.avoidBelow && <span class="db-muted">(current)</span>}
              {s.avoidUntested && (
                <div class="db-muted">
                  No fights quoted {gapText(s.avoidUntested)} yet, so the data can't say whether to avoid those too.
                </div>
              )}
            </>
          ) : (
            <span class="db-muted">
              Avoid: not enough fights yet: needs {ARENA_GATE_MIN_FIGHTS} below one cut-off with at most 1 in 10 won (now {s.current.avoid.fights} under{' '}
              {config.avoidBelow}%).
            </span>
          )}
        </li>
      </ul>
      <p class="db-note">
        Suggested from your own fights, never applied without a click. Defaults: {DEFAULT_ARENA_GATE_CONFIG.beatableFrom}% /{' '}
        {DEFAULT_ARENA_GATE_CONFIG.avoidBelow}%.
      </p>
    </section>
  );
}

function MemoryCard({ memory, prefs, seasonStart }: { memory: ArenaOpponentMemory; prefs: PageFeaturePreferences | null; seasonStart: number | null }) {
  const all = Object.values(memory);
  const toughest = all
    .filter((r) => r.history.some((f) => !f.won))
    .sort((a, b) => b.history.filter((f) => !f.won).length - a.history.filter((f) => !f.won).length || b.lastAt - a.lastAt)
    .slice(0, 8);
  return (
    <section class="db-card">
      <h2 class="db-h">Opponent Memory</h2>
      <p class="db-p">
        {prefs?.arenaOpponentMemory ? 'On.' : 'Off — switch it on under Arena settings above.'} {all.length} opponent
        {all.length === 1 ? '' : 's'} remembered (recorded whether the setting is on or off).
      </p>
      {toughest.length > 0 && (
        <>
          <div class="db-subh">Opponents you’ve lost to</div>
          <ul class="db-plain">
            {toughest.map((r) => (
              <li key={r.name}>
                <b>{r.name}</b>: {memoryText(r, currentSeasonStart(seasonStart))}
                {r.armour !== null ? ` · armour ${r.armour.toLocaleString('en-US')}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ImportCard() {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<ArenaImportProgress | null>(null);
  const [result, setResult] = useState<ArenaImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = progress !== null && result === null && error === null;

  return (
    <section class="db-card db-card--wide">
      <h2 class="db-h">Import fight history</h2>
      <p class="db-p">
        The extension’s own request archive only keeps about 2 days. To fill Opponent Memory and the Safety Gate’s record with older fights, choose
        your HTTP-archive exports (<code>fifth-family-archive-…ndjson.gz</code>): the files in <code>tff archives</code>, and the monthly ones in{' '}
        <code>merged/</code> too if you want older opponents. Pick as many as you like, overlapping or not: nothing is counted twice, and there’s
        no need to merge them first. Only Arena fights and Arena pages are read.
      </p>
      <div class="db-fields">
        <input
          type="file"
          multiple
          accept=".gz,.ndjson"
          disabled={running}
          onChange={(e) => {
            setFiles([...((e.target as HTMLInputElement).files ?? [])]);
            setResult(null);
            setError(null);
            setProgress(null);
          }}
        />
        <button
          class="db-btn db-btn--primary"
          disabled={files.length === 0 || running}
          onClick={() => {
            setResult(null);
            setError(null);
            setProgress({ file: '', filesDone: 0, filesTotal: files.length, fights: 0 });
            importArenaExports(files, setProgress).then(setResult, (err) => setError(String(err)));
          }}
        >
          {running ? 'Importing…' : `Import ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {running && progress && (
        <p class="db-muted">
          File {Math.min(progress.filesDone + 1, progress.filesTotal)} of {progress.filesTotal}
          {progress.file ? `: ${progress.file}` : ''} · {progress.fights} fights found so far. Large files take a while; keep this tab open.
        </p>
      )}
      {result && (
        <p class="db-ok">
          Done: {result.fightsRead} fights read. Opponents remembered {result.opponentsBefore} → {result.opponentsAfter}; fights in the Safety Gate
          record {result.quotedBefore} → {result.quotedAfter}.
        </p>
      )}
      {error && <p class="db-warn">Import stopped: {error}</p>}
    </section>
  );
}

export function ArenaSection() {
  const config = useStored(STORAGE_KEYS.ARENA_GATE_CONFIG, storage.getArenaGateConfig, DEFAULT_ARENA_GATE_CONFIG);
  const record = useStored<ArenaQuotedFight[]>(STORAGE_KEYS.ARENA_QUOTE_RECORD, storage.getArenaQuoteRecord, []);
  const memory = useStored<ArenaOpponentMemory>(STORAGE_KEYS.ARENA_OPPONENT_MEMORY, storage.getArenaOpponentMemory, {});
  const prefs = useStored<PageFeaturePreferences | null>(STORAGE_KEYS.PAGE_FEATURE_PREFERENCES, storage.getPageFeaturePreferences, null);
  // The current season's start, read from the Arena page's season list.
  const seasonStart = useStored<number | null>(STORAGE_KEYS.ARENA_SEASON_START, storage.getArenaSeasonStart, null);
  return (
    <div class="db-grid">
      <section class="db-card">
        <h2 class="db-h">Arena settings</h2>
        <p class="db-p">The same switches as in Settings; changing one here changes it there too.</p>
        <PageFeatureSettings title="On the Arena page" only={(id) => id.startsWith('arena')} />
        <NotificationSettings title="Notifications" only={(id) => id.startsWith('arena')} />
      </section>
      <GateCard config={config} record={record} prefs={prefs} />
      <MemoryCard memory={memory} prefs={prefs} seasonStart={seasonStart} />
      <ImportCard />
    </div>
  );
}
