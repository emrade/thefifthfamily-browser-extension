import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { STORAGE_KEYS } from '@/shared/constants';
import { storage } from '@/shared/storage';
import type { ExtensionMessage } from '@/shared/messaging';
import {
  STAT_KEYS,
  bonusOrigin,
  buildBreakdown,
  classifyBonus,
  type Breakdown,
  type FlatPart,
  type LoadoutBonus,
  type Quad,
  type StatKey,
  type StatSources,
} from '@/shared/statBreakdown';
import type { StatRefreshResult } from '@/background/features/statSources';
import type { PetRosterEntry, PetScanState, PetSpendPlanEntry } from '@/shared/types';
import {
  bestPetStat, bonusGains, bonusRates, petOptions, petPointPlan, planPower, sortCareers, vehicleOptions,
  type CareerSort, type Gain, type GainStatus, type PetOption, type PetStrategy, type VehicleOption,
} from '@/shared/statAdvisor';
import { getRoster } from '@/shared/petRoster';

/**
 * Dashboard → Stats: where each of the four combat stats comes from, read
 * from the game's own pages (see shared/statBreakdown.ts). The Refresh button
 * reads those pages once; otherwise it updates as the player opens them.
 */

const STAT_LABEL: Record<StatKey, string> = { str: 'Strength', def: 'Defence', agi: 'Agility', dex: 'Dexterity' };
const STAT_SHORT: Record<StatKey, string> = { str: 'STR', def: 'DEF', agi: 'AGI', dex: 'DEX' };
const SOURCE_KEYS = [
  STORAGE_KEYS.STAT_SRC_GYM, STORAGE_KEYS.STAT_SRC_GEAR, STORAGE_KEYS.STAT_SRC_PET, STORAGE_KEYS.STAT_SRC_CAR, STORAGE_KEYS.STAT_SRC_LOADOUT,
  STORAGE_KEYS.STAT_SRC_ACADEMY, STORAGE_KEYS.STAT_SRC_BLOODLINE, STORAGE_KEYS.STAT_SRC_CAREERS,
];
const DAY_MS = 86_400_000;

type PartKey = FlatPart['key'] | 'bonus';
const PART_HINT: Record<PartKey, string> = {
  trained: 'trained at the Gym',
  gear: 'your 7 equipped items',
  car: 'your equipped car',
  pet: 'your active pet',
  vigilantes: 'V2 Vigilantes',
  bonus: 'your % bonuses (the rest of the total)',
};

const n = (v: number) => Math.round(v).toLocaleString();
const pct = (v: number) => `${Number(v.toFixed(2))}%`;

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

function stamp(at: number): string {
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function useSources(): StatSources | null {
  const [src, setSrc] = useState<StatSources | null>(null);
  useEffect(() => {
    const load = () => storage.getStatSources().then(setSrc);
    load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && SOURCE_KEYS.some((k) => k in changes)) load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return src;
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// ── Toolbar ────────────────────────────────────────────────────────────

type SourceKey = Exclude<keyof StatSources, 'petMemory'>;

const SOURCE_ROWS: { key: SourceKey; label: string; where: string }[] = [
  { key: 'gym', label: 'Gym', where: 'the Gym' },
  { key: 'gear', label: 'Inventory', where: 'your Inventory' },
  { key: 'pet', label: 'Menagerie', where: 'the Menagerie → Care tab' },
  { key: 'car', label: 'Chop Shop', where: 'the Chop Shop' },
  { key: 'academy', label: 'Academy', where: 'the Academy' },
  { key: 'bloodline', label: 'Bloodline', where: 'the Bloodline page' },
  { key: 'careers', label: 'Careers', where: 'the Careers page' },
  { key: 'loadout', label: 'Arena lock-in', where: 'the Arena at the start of a season' },
];
const REFRESHABLE: Partial<Record<SourceKey, keyof StatRefreshResult['errors']>> = {
  gym: 'gym', gear: 'gear', pet: 'pet', car: 'car', academy: 'academy', bloodline: 'bloodline', careers: 'careers',
};

type SourceState = 'ok' | 'stale' | 'missing' | 'error';

/** One line of status for the whole set, chips only for what needs you, and
 *  every source behind "Show all": eight chips at once was noise. */
function Toolbar({ src, now }: { src: StatSources; now: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StatRefreshResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const msg: ExtensionMessage = { type: 'stat-sources-refresh-requested' };
      setResult((await chrome.runtime.sendMessage(msg)) as StatRefreshResult);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rows = SOURCE_ROWS.map((row) => {
    const snap = src[row.key];
    const err = result && REFRESHABLE[row.key] ? result.errors[REFRESHABLE[row.key]!] : undefined;
    // A failed refresh keeps the earlier reading: say so, reason on hover.
    const state: SourceState = err ? (snap ? 'stale' : 'error') : !snap ? 'missing' : row.key !== 'loadout' && now - snap.at > DAY_MS ? 'stale' : 'ok';
    const when = err ? (snap ? `kept from ${ago(snap.at, now)}` : 'not read') : snap ? ago(snap.at, now) : 'not read yet';
    const title = err ? `Not updated: ${err}${snap ? `. Showing the reading from ${stamp(snap.at)}.` : ''}` : snap ? `Read ${stamp(snap.at)}` : `Open ${row.where} to fill this in`;
    return { ...row, snap, err, state, when, title };
  });
  const read = rows.filter((r) => r.snap);
  const newest = read.length ? Math.max(...read.map((r) => r.snap!.at)) : null;
  // The lock-in only comes once a season: not something to act on.
  const attention = rows.filter((r) => r.state !== 'ok' && !(r.key === 'loadout' && r.state === 'missing'));
  const shown = showAll ? rows : attention;

  return (
    <section class="st-toolbar" aria-label="Data sources">
      <div class="st-toolbar__lead">
        <button type="button" class="db-btn db-btn--primary st-refresh" onClick={refresh} disabled={busy} aria-busy={busy}>
          {busy ? 'Reading the game…' : 'Refresh'}
        </button>
        <div class="st-toolbar__status">
          <p class="st-toolbar__line">
            {read.length} of {rows.length} sources read{newest ? `, newest ${ago(newest, now)}` : ''}.
            {attention.length === 0 && ' Everything is up to date.'}
          </p>
          <p class="st-toolbar__hint">Refresh reads your Gym, Inventory, Menagerie, Chop Shop, Academy, Bloodline and Careers pages once.</p>
        </div>
        <button type="button" class="st-linkbtn" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Hide sources' : 'Show all sources'}
        </button>
      </div>
      {shown.length > 0 && (
        <ul class="st-sources">
          {shown.map((r) => (
            <li key={r.key} class={`st-source st-source--${r.state}`} title={r.title}>
              <span class="st-source__dot" aria-hidden="true" />
              <span class="st-source__name">{r.label}</span>
              <span class="st-source__when">{r.when}</span>
            </li>
          ))}
        </ul>
      )}
      {failed && <p class="db-warn">Refresh failed: {failed}</p>}
      {result && Object.keys(result.errors).length > 0 && (
        <ul class="st-refresh-notes">
          {rows.filter((r) => r.err).map((r) => (
            <li key={r.key}>
              <b>{r.label}:</b> {r.err}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Stat cards ─────────────────────────────────────────────────────────

interface Seg {
  key: PartKey;
  label: string;
  value: number;
}

function segments(b: Breakdown, k: StatKey): Seg[] {
  return [
    ...b.parts.map((p) => ({ key: p.key as PartKey, label: SEG_LABEL[p.key], value: p.values[k] })),
    { key: 'bonus' as const, label: SEG_LABEL.bonus, value: b.bonus[k] },
  ].filter((x) => x.value > 0);
}

const SEG_LABEL: Record<PartKey, string> = { trained: 'Trained', gear: 'Gear', car: 'Car', pet: 'Pet', vigilantes: 'Vigilantes', bonus: 'Bonuses' };

/** The bar plus its parts written out underneath, so it reads without a
 *  hover: colours alone said nothing (player feedback, 2026-11-09). */
function Composition({ b, k }: { b: Breakdown; k: StatKey }) {
  const segs = segments(b, k);
  const total = segs.reduce((acc, x) => acc + x.value, 0) || 1;
  const share = (v: number) => Math.round((v / total) * 100);
  const ordered = [...segs].sort((x, y) => y.value - x.value);
  return (
    <div class="st-mixwrap">
      <div class="st-bar" aria-hidden="true">
        {segs.map((x) => (
          <span key={x.key} class={`st-seg st-seg--${x.key}`} style={{ width: `${(x.value / total) * 100}%` }} title={`${x.label}: ${n(x.value)} (${share(x.value)}%)`} />
        ))}
      </div>
      <ul class="st-mix" aria-label={`Where ${STAT_LABEL[k]} comes from`}>
        {ordered.map((x) => (
          <li key={x.key} title={`${x.label}: ${n(x.value)}`}>
            <span class={`st-swatch st-seg--${x.key}`} aria-hidden="true" />
            <span class="st-mix__l">{x.label}</span>
            <span class="st-mix__v">{share(x.value) < 1 ? '<1' : share(x.value)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One key for every bar and table swatch on the page. */
function Legend({ b }: { b: Breakdown }) {
  const keys: PartKey[] = [...b.parts.map((p) => p.key as PartKey), 'bonus'];
  return (
    <ul class="st-legend" aria-label="Colour key">
      {keys.map((key) => (
        <li key={key} title={PART_HINT[key]}>
          <span class={`st-swatch st-seg--${key}`} aria-hidden="true" />
          <span>{SEG_LABEL[key]}</span>
          <span class="st-legend__hint">{PART_HINT[key]}</span>
        </li>
      ))}
    </ul>
  );
}

function effect(src: StatSources, k: StatKey): { line: string; next: string | null } | null {
  const g = src.gym;
  if (!g) return null;
  const roll = k === 'def' ? g.block : k === 'agi' ? g.dodge : k === 'dex' ? g.crit : null;
  if (k === 'str') return g.defPenPct !== null ? { line: `Ignores ${g.defPenPct}% of enemy Defence`, next: null } : null;
  if (!roll) return null;
  const what = k === 'def' ? 'block' : k === 'agi' ? 'dodge' : 'crit';
  return { line: `${roll.pct}% ${what} chance`, next: roll.next ? `+${n(roll.next.need)} for ${roll.next.pct}%` : null };
}

function StatCards({ b, src }: { b: Breakdown; src: StatSources }) {
  const locked = src.loadout?.fighting;
  return (
    <div class="st-cards" role="list">
      {STAT_KEYS.map((k) => {
        const fx = effect(src, k);
        const diff = locked ? b.total[k] - locked[k] : 0;
        return (
          <article key={k} role="listitem" class={`st-card st-card--${k}`} aria-label={STAT_LABEL[k]}>
            <header class="st-card__head">
              <span class="st-card__name">{STAT_LABEL[k]}</span>
              <span class="st-card__short">{STAT_SHORT[k]}</span>
            </header>
            <div class="st-card__total">{n(b.total[k])}</div>
            <div class="st-card__arena">
              {locked ? (
                <>
                  Arena this season <b>{n(locked[k])}</b>
                  {diff !== 0 && <span class="st-card__diff">{diff > 0 ? `+${n(diff)}` : n(diff)} since lock-in</span>}
                </>
              ) : (
                'Arena value: set when the next season starts'
              )}
            </div>
            <Composition b={b} k={k} />
            {fx && (
              <div class="st-card__fx">
                <span>{fx.line}</span>
                {fx.next && <span class="st-card__next">{fx.next}</span>}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

// ── Sources table ──────────────────────────────────────────────────────

function Cells({ q }: { q: Quad }) {
  return (
    <>
      {STAT_KEYS.map((k) => (
        <td key={k} class="st-num">{n(q[k])}</td>
      ))}
    </>
  );
}

/** One row label. The cell itself stays a plain table cell (a flex `<th>`
 *  drops out of table layout and its row drifts off the number columns). */
function RowHead({ swatch, children, sub }: { swatch?: PartKey; children: ComponentChildren; sub?: boolean }) {
  return (
    <th scope="row" class={sub ? 'st-rowhead st-rowhead--sub' : 'st-rowhead'}>
      <div class="st-rowhead__in">
        {swatch ? <span class={`st-swatch st-seg--${swatch}`} aria-hidden="true" /> : !sub && <span class="st-swatch st-swatch--none" aria-hidden="true" />}
        {children}
      </div>
    </th>
  );
}

function SourcesTable({ b, src }: { b: Breakdown; src: StatSources }) {
  const [openGear, setOpenGear] = useState(false);
  const flat: Quad = { str: 0, def: 0, agi: 0, dex: 0 };
  for (const p of b.parts) for (const k of STAT_KEYS) flat[k] += p.values[k];

  return (
    <section class="db-card db-card--wide">
      <h2 class="db-h">Where your stats come from</h2>
      <div class="st-table-wrap">
        <table class="st-table">
          <colgroup>
            <col />
            {STAT_KEYS.map((k) => (
              <col key={k} class="st-col-num" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" class="st-rowhead">Source</th>
              {STAT_KEYS.map((k) => (
                <th key={k} scope="col" class={`st-num st-th--${k}`}>{STAT_SHORT[k]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.parts.map((p) => (
              <Fragment key={p.key}>
                <tr title={PART_HINT[p.key]}>
                  <RowHead swatch={p.key}>
                    {p.key === 'gear' ? (
                      <button type="button" class="st-expand" aria-expanded={openGear} onClick={() => setOpenGear(!openGear)}>
                        {p.label}
                        <span class="st-muted"> · {src.gear?.items.length ?? 0} items</span>
                        <span class="st-caret" aria-hidden="true">{openGear ? '▴' : '▾'}</span>
                      </button>
                    ) : (
                      <span>{p.label}</span>
                    )}
                  </RowHead>
                  <Cells q={p.values} />
                </tr>
                {p.key === 'gear' && openGear && src.gear && (
                  <>
                    {src.gear.items.map((it) => (
                      <tr key={it.name} class="st-sub">
                        <RowHead sub>
                          <span>{it.name}</span>
                          <span class="st-enh">+{it.enhancement}</span>
                          <span class="st-muted">{it.slot}</span>
                        </RowHead>
                        <Cells q={it.stats} />
                      </tr>
                    ))}
                    {src.gear.shownExtra && (
                      <tr class="st-sub" title="The inventory page adds this to your gear totals without naming where it comes from.">
                        <RowHead sub>
                          <span>Extra gear bonus</span>
                          <span class="st-muted">not named by the game</span>
                        </RowHead>
                        <Cells q={src.gear.shownExtra} />
                      </tr>
                    )}
                  </>
                )}
              </Fragment>
            ))}
            <tr class="st-subtotal">
              <RowHead>
                <span>Before percentage bonuses</span>
              </RowHead>
              <Cells q={flat} />
            </tr>
            <tr title={PART_HINT.bonus}>
              <RowHead swatch="bonus">
                <span>Percentage bonuses</span>
              </RowHead>
              {STAT_KEYS.map((k) => (
                <td key={k} class="st-num">
                  +{n(b.bonus[k])}
                  {flat[k] > 0 && <span class="st-pctof">+{Math.round((b.bonus[k] / flat[k]) * 100)}%</span>}
                </td>
              ))}
            </tr>
            <tr class="st-total">
              <RowHead>
                <span>Total</span>
              </RowHead>
              <Cells q={b.total} />
            </tr>
          </tbody>
        </table>
      </div>
      <p class="db-note">
        Total is the game's own figure from the Gym page. Percentage bonuses are what's left of it after the sources above, so they also hold
        anything not read yet.
      </p>
      {b.missing.length > 0 && <p class="st-missing">Still to read: {b.missing.join(', ')}. Press Refresh, or open those pages in the game.</p>}
    </section>
  );
}

// ── Bonus lists ────────────────────────────────────────────────────────

function PercentBonuses({ b, src }: { b: Breakdown; src: StatSources }) {
  const [stat, setStat] = useState<StatKey>('str');
  if (!src.loadout) {
    return (
      <section class="db-card">
        <h2 class="db-h">Percentage bonuses</h2>
        <p class="db-empty">The full bonus list comes with the Arena's season lock-in. It will appear here after the next one.</p>
      </section>
    );
  }
  const groups = b.pct[stat];
  return (
    <section class="db-card">
      <h2 class="db-h">Percentage bonuses</h2>
      <div class="st-tabs" role="tablist" aria-label="Stat">
        {STAT_KEYS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={stat === k} class={`st-tab st-tab--${k}${stat === k ? ' is-active' : ''}`} onClick={() => setStat(k)}>
            {STAT_SHORT[k]} <span class="st-tab__v">{pct(b.pctTotal[k])}</span>
          </button>
        ))}
      </div>
      <ul class="st-origins" role="tabpanel">
        {groups.map((g) => (
          <li key={g.origin}>
            <details class="st-origin">
              <summary>
                <span class="st-origin__name">{g.origin}</span>
                <span class="st-origin__bar" aria-hidden="true">
                  <i style={{ width: `${(g.value / (groups[0]?.value || 1)) * 100}%` }} />
                </span>
                <span class="db-mono st-origin__v">+{pct(g.value)}</span>
              </summary>
              <ul class="st-perks">
                {g.entries.map((e, i) => (
                  <li key={i}>
                    <span>{e.source.includes(':') ? e.source.slice(e.source.indexOf(':') + 1).trim() : e.source}</span>
                    <span class="db-mono">+{pct(e.value)}</span>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      <p class="db-note">From your Arena lock-in, {stamp(src.loadout.at)}. Bonuses earned since then aren't listed until the next one.</p>
    </section>
  );
}

const FIGHT_LABEL: Record<string, string> = {
  attack_damage: 'Attack damage',
  def_efficiency: 'Defence efficiency',
  raw_damage_reduction: 'Damage reduction',
  block_bonus: 'Block chance',
  dodge_bonus: 'Dodge chance',
  crit_chance: 'Crit chance',
  crit_damage: 'Crit damage',
  max_vitality: 'Max vitality',
};

function FightBonuses({ src }: { src: StatSources }) {
  const g = src.gym;
  const groups = new Map<string, LoadoutBonus[]>();
  for (const bn of src.loadout?.bonuses ?? []) {
    if (classifyBonus(bn.type).kind !== 'fight') continue;
    groups.set(bn.type, [...(groups.get(bn.type) ?? []), bn]);
  }
  const rows = [...groups.entries()].map(([type, list]) => ({ type, total: list.reduce((s, x) => s + x.value, 0), list }));
  rows.sort((a, b) => b.total - a.total);
  return (
    <section class="db-card">
      <h2 class="db-h">In the fight</h2>
      {g && (
        <div class="st-power">
          <div>
            <div class="st-power__v db-mono">{g.combatPower !== null ? n(g.combatPower) : '—'}</div>
            <div class="st-power__l">Combat Power{g.combatTier ? ` · ${g.combatTier}` : ''}</div>
          </div>
          <p class="st-power__note">The four totals added together.</p>
        </div>
      )}
      {rows.length > 0 ? (
        <ul class="st-fight">
          {rows.map((r) => (
            <li key={r.type} title={r.list.map((x) => `${x.source}: +${pct(x.value)}`).join('\n')}>
              <span>{FIGHT_LABEL[r.type] ?? r.type.replace(/_/g, ' ')}</span>
              <span class="st-fight__from">{[...new Set(r.list.map((x) => bonusOrigin(x.source)))].join(', ')}</span>
              <span class="db-mono st-fight__v">+{pct(r.total)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="db-empty">Fight bonuses come with the Arena lock-in.</p>
      )}
      <p class="db-note">These change damage and defence in a fight, not the four stats.</p>
    </section>
  );
}

function HowItWorks() {
  return (
    <section class="db-card db-card--wide">
      <h2 class="db-h">How this is worked out</h2>
      <ul class="db-plain st-how">
        <li><b>Totals</b> are the game's own numbers from the Gym page ("after gym, gear, vehicle, perks & bloodline").</li>
        <li><b>Gear:</b> each item's stats are its base stats × its forge bonus (+7 = +90%, +8 = +110%, +9 = +130%, from the game's wiki).</li>
        <li><b>Pet:</b> only the active pet counts, at its "In Combat" stats from the Menagerie care tab.</li>
        <li><b>Percentage bonuses</b> multiply the flat amounts. The game doesn't say in what order they stack, so their share is shown as what's left of the total rather than recalculated.</li>
        <li><b>Arena</b> uses the values locked at the start of each season. Changes after that count from the next season.</li>
      </ul>
    </section>
  );
}

// ── Advisor ────────────────────────────────────────────────────────────
//
// Three sub-tabs (Car, Pet, Bonuses), each opening with its verdict in one
// sentence, then the ranked options with the current choice pinned first as
// the reference. Every tab label carries a short status so the player sees
// where the gains are without opening each one.

const signed = (v: number) => (Math.round(v) > 0 ? `+${n(v)}` : Math.round(v) === 0 ? '0' : `−${n(Math.abs(v))}`);
const money = (v: number) => (v >= 1e6 ? `$${Number((v / 1e6).toFixed(1))}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${v}`);
const powerOf = (b: Breakdown) => STAT_KEYS.reduce((s, k) => s + b.total[k], 0);
/** Under half a percent of Combat Power is "about even": inside the estimate's noise. */
const evenBand = (b: Breakdown) => Math.max(10, powerOf(b) * 0.005);

function Delta({ v }: { v: number }) {
  const r = Math.round(v);
  return <span class={r > 0 ? 'st-up' : r < 0 ? 'st-down' : 'st-flat'}>{signed(v)}</span>;
}

function Verdict({ head, body }: { head: string; body?: ComponentChildren }) {
  return (
    <div class="st-verdict">
      <p class="st-verdict__head">{head}</p>
      {body && <p class="st-verdict__body">{body}</p>}
    </div>
  );
}

function NeedsSource({ what }: { what: string }) {
  return <p class="db-empty">Press Refresh (or open {what} in the game) to fill this in.</p>;
}

// Car

const CAR_ROWS = 6;

function RaceCell({ o, cur }: { o: VehicleOption; cur: VehicleOption | undefined }) {
  const parts: [string, number, number | undefined][] = [
    ['Speed', o.race.speed, cur?.race.speed],
    ['Accel', o.race.accel, cur?.race.accel],
    ['Handling', o.race.handling, cur?.race.handling],
  ];
  return (
    <span class="st-race" title={parts.map(([l, v]) => `${l} ${v}`).join(', ')}>
      {parts.map(([l, v, c]) => (
        <span key={l} class={c === undefined || o.status === 'equipped' || v === c ? '' : v > c ? 'st-up' : 'st-down'}>{v}</span>
      ))}
    </span>
  );
}

function carSummary(b: Breakdown, src: StatSources): { status: string; best: VehicleOption | null } | null {
  const opts = vehicleOptions(src, b);
  if (!opts) return null;
  const best = opts.filter((o) => o.status !== 'equipped').sort((x, y) => y.powerDelta - x.powerDelta)[0] ?? null;
  return { status: best && best.powerDelta > evenBand(b) ? `+${n(best.powerDelta)}` : 'Best already', best };
}

function CarAdvice({ b, src }: { b: Breakdown; src: StatSources }) {
  const [all, setAll] = useState(false);
  const opts = vehicleOptions(src, b);
  if (!opts) return <NeedsSource what="the Chop Shop" />;
  const current = opts.find((o) => o.status === 'equipped');
  const others = opts.filter((o) => o.status !== 'equipped').sort((x, y) => y.powerDelta - x.powerDelta);
  const even = evenBand(b);
  const best = others[0];
  const close = others.filter((o) => Math.abs(o.powerDelta) <= even);
  const rate = bonusRates(b);
  const ranked = [current, ...others].filter(Boolean) as VehicleOption[];
  const shown = all ? ranked : ranked.slice(0, CAR_ROWS);
  return (
    <>
      {best && best.powerDelta > even ? (
        <Verdict head={`${best.name} would add about ${n(best.powerDelta)} Combat Power.`} body={best.status === 'dealer' ? `It costs ${money(best.priceCash)} at the dealer.` : 'You already own it.'} />
      ) : (
        <Verdict
          head={`${current?.name ?? 'Your car'} is already your best car for combat.`}
          body={close.length ? `${close.map((o) => o.name).join(' and ')} come${close.length === 1 ? 's' : ''} out about even: the same total, spread differently.` : 'Nothing you own or can buy adds more.'}
        />
      )}
      <p class="st-table-hint">
        <span class="st-table-hint__base" aria-hidden="true" /> First row: what yours adds now. Other rows: the change if you switched.
      </p>
      <div class="st-table-wrap">
        <table class="st-table st-adv">
          <thead>
            <tr>
              <th scope="col" class="st-rowhead">Car</th>
              {STAT_KEYS.map((k) => (
                <th key={k} scope="col" class={`st-num st-th--${k}`}>{STAT_SHORT[k]}</th>
              ))}
              <th scope="col" class="st-num">Power</th>
              <th scope="col" class="st-num" title="Racing speed, acceleration and handling">Racing</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.name} class={o.status === 'equipped' ? 'st-adv__current' : ''}>
                <th scope="row" class="st-rowhead">
                  <div class="st-adv__item">
                    <span class="st-adv__name">{o.name}</span>
                    <span class="st-adv__meta">{o.status === 'equipped' ? 'Equipped now' : o.status === 'owned' ? 'You own it' : `${money(o.priceCash)} at the dealer`}{o.vehicleClass && `, class ${o.vehicleClass}`}</span>
                    {(!o.complete || o.crossings.length > 0) && (
                      <span class="st-adv__notes">
                        {o.crossings.map((c) => (
                          <span key={c.label} class="st-tag st-tag--up">{c.label}</span>
                        ))}
                        {!o.complete && <span class="st-tag st-tag--warn" title="The game doesn't say whether a car with missing parts still gives its stat bonus.">No parts fitted: bonus may not count</span>}
                      </span>
                    )}
                  </div>
                </th>
                {STAT_KEYS.map((k) => (
                  <td key={k} class="st-num" title={`The car gives ${o.stats[k]} ${STAT_SHORT[k]}`}>
                    {o.status === 'equipped' ? n(o.stats[k] * rate[k]) : <Delta v={o.delta[k]} />}
                  </td>
                ))}
                <td class="st-num st-adv__power">{o.status === 'equipped' ? n(STAT_KEYS.reduce((t, k) => t + o.stats[k] * rate[k], 0)) : <Delta v={o.powerDelta} />}</td>
                <td class="st-num"><RaceCell o={o} cur={current} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ranked.length > CAR_ROWS && (
        <button type="button" class="st-linkbtn st-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer cars' : `Show all ${ranked.length} cars`}
        </button>
      )}
      <p class="db-note">
        Both include your bonuses (STR ×{rate.str.toFixed(2)}, DEF ×{rate.def.toFixed(2)}, AGI ×{rate.agi.toFixed(2)}, DEX ×{rate.dex.toFixed(2)}). Racing is
        speed, acceleration and handling, against your car.
      </p>
    </>
  );
}

// Pet

const PET_SHOP_ROWS = 6;

function petSummary(b: Breakdown, src: StatSources): { status: string } | null {
  const p = petOptions(src, b);
  if (!p) return null;
  const best = p.options.filter((o) => o.status === 'owned' && o.powerDelta !== null).sort((x, y) => y.powerDelta! - x.powerDelta!)[0];
  if (best && best.powerDelta! > evenBand(b)) return { status: `+${n(best.powerDelta!)}` };
  return { status: p.spend ? `${p.spend.points} points to spend` : 'Best already' };
}

function PetRow({ o, active, rate }: { o: PetOption; active?: boolean; rate: Quad }) {
  return (
    <tr class={active ? 'st-adv__current' : ''}>
      <th scope="row" class="st-rowhead">
        <div class="st-adv__item">
          <span class="st-adv__name">{o.name}</span>
          <span class="st-adv__meta">
            {[o.rarity, active ? 'Active now' : o.status === 'shop' ? `${money(o.price ?? 0)}, ${o.group === 'Exclusive' ? 'exclusive' : `sold in ${o.group}`}` : null, o.grownPct !== null ? `${o.grownPct}% grown` : null]
              .filter(Boolean)
              .join(', ')}
          </span>
          {o.status === 'owned' && (
            <span
              class={`st-adv__source${o.source === 'remembered' ? ' is-real' : ''}`}
              title={
                o.source === 'remembered'
                  ? 'Its real stats from the last time it was your active pet, training included.'
                  : "It hasn't been your active pet since the extension started remembering, so these are its base stats from the game's wiki, without your training."
              }
            >
              {o.source === 'remembered' && o.seenAt ? `Real stats from ${stamp(o.seenAt)}` : o.source === 'wiki' ? 'Wiki base stats, training not included' : 'Not in the wiki'}
            </span>
          )}
          {(o.perk || (active && (o.points ?? 0) >= 5)) && (
            <span class="st-adv__notes">
              {o.perk && <span class="st-tag st-tag--info">{o.perk}</span>}
              {active && (o.points ?? 0) >= 5 && <span class="st-tag" title="5 pet points buy 1 stat point">{Math.floor(o.points! / 5)} stat points to spend</span>}
            </span>
          )}
        </div>
      </th>
      {STAT_KEYS.map((k) => (
        <td key={k} class="st-num" title={active && o.combat ? `The pet has ${n(o.combat[k])} ${STAT_SHORT[k]} in combat` : undefined}>
          {!o.combat ? '—' : active ? n(o.combat[k] * rate[k]) : <Delta v={o.delta![k]} />}
        </td>
      ))}
      <td class="st-num st-adv__power">{active ? (o.combat ? n(STAT_KEYS.reduce((t, k) => t + o.combat![k] * rate[k], 0)) : '—') : o.powerDelta === null ? <span class="st-flat" title="Not listed in the game's wiki">not in wiki</span> : <Delta v={o.powerDelta} />}</td>
    </tr>
  );
}

function PetHead({ label }: { label: string }) {
  return (
    <thead>
      <tr>
        <th scope="col" class="st-rowhead">{label}</th>
        {STAT_KEYS.map((k) => (
          <th key={k} scope="col" class={`st-num st-th--${k}`}>{STAT_SHORT[k]}</th>
        ))}
        <th scope="col" class="st-num">Power</th>
      </tr>
    </thead>
  );
}

function usePetScan(): PetScanState | null {
  const [state, setState] = useState<PetScanState | null>(null);
  useEffect(() => {
    storage.getPetScanState().then(setState);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && STORAGE_KEYS.PET_SCAN_STATE in changes) setState(changes[STORAGE_KEYS.PET_SCAN_STATE].newValue as PetScanState);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return state;
}

/** "Read all pets' stats": sets each pet active for a moment so the game
 *  shows its real stats, then puts the original back. */
function PetScanBar({ estimated, total, active }: { estimated: number; total: number; active: string }) {
  const state = usePetScan();
  const [failed, setFailed] = useState<string | null>(null);
  const send = async (msg: ExtensionMessage) => {
    setFailed(null);
    try {
      const r = await chrome.runtime.sendMessage(msg);
      const res = r as { started?: boolean; reason?: string } | undefined;
      if (res && res.started === false) setFailed(res.reason ?? 'A pet run is already going.');
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    }
  };
  const minutes = Math.max(1, Math.round((total * 5.5 + 10) / 60));
  if (state?.running) {
    const pctDone = state.total ? Math.round((state.done / state.total) * 100) : 0;
    return (
      <div class="st-scan is-running" role="status" aria-live="polite">
        <div class="st-scan__text">
          <b>{state.stopRequested ? `Stopping, putting ${active} back…` : state.current ? `${state.mode === 'spend' ? 'Spending points on' : 'Reading'} ${state.current}` : 'Starting…'}</b>
          <span>
            {state.done} of {state.total} pets
          </span>
          <div class="st-scan__track" aria-hidden="true">
            <i style={{ width: `${pctDone}%` }} />
          </div>
        </div>
        <button type="button" class="db-btn" onClick={() => send({ type: 'pet-scan-stop-requested' })} disabled={state.stopRequested}>
          Stop
        </button>
      </div>
    );
  }
  const last = state?.finishedAt && state.mode !== 'spend' ? state : null;
  return (
    <div class="st-scan">
      <div class="st-scan__text">
        <b>{estimated > 0 ? `${estimated} of your pets use wiki estimates` : 'Every pet has real stats'}</b>
        <span>
          Reads each pet's real stats by setting it active for a few seconds, then puts {active} back. Nothing is spent. About {minutes} min.
        </span>
        {last && (
          <span class={last.error ? 'st-scan__result is-warn' : 'st-scan__result'}>
            {last.error
              ? last.error
              : `Read ${last.read.length} pets ${ago(last.finishedAt!, Date.now())}${last.restored ? `, ${last.restored} is active again` : ''}.`}
            {last.skipped.length > 0 && ` Skipped: ${last.skipped.map((x) => `${x.name} (${x.reason})`).join(', ')}.`}
          </span>
        )}
        {failed && <span class="st-scan__result is-warn">{failed}</span>}
      </div>
      <button type="button" class={estimated > 0 ? 'db-btn db-btn--primary' : 'db-btn'} onClick={() => send({ type: 'pet-scan-start-requested' })}>
        {estimated > 0 ? "Read all pets' stats" : 'Read again'}
      </button>
    </div>
  );
}

const STRATEGY_LABEL: Record<Exclude<PetStrategy, StatKey>, string> = { best: 'Best combat stat', even: 'Even split', skip: "Don't spend" };

function useRosterMilestones(): Map<string, PetRosterEntry> {
  const [map, setMap] = useState<Map<string, PetRosterEntry>>(new Map());
  useEffect(() => {
    getRoster()
      .then((rows) => setMap(new Map(rows.map((r) => [r.name.toLowerCase(), r]))))
      .catch(() => setMap(new Map()));
  }, []);
  return map;
}

/** Spend pet points: per pet, best combat stat, even split or one stat, with
 *  advice per row; then a preview and an explicit confirm (permanent). */
function PetPointsPlanner({ b, src, startOpen }: { b: Breakdown; src: StatSources; startOpen?: boolean }) {
  const scan = usePetScan();
  const milestones = useRosterMilestones();
  const [open, setOpen] = useState(!!startOpen);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!startOpen) return;
    setOpen(true);
    // Bring it into view once it has rendered open.
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [startOpen]);
  const [strategy, setStrategy] = useState<Record<number, PetStrategy>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const pet = src.pet;
  const roster = pet?.roster;
  if (!pet || !roster) return null;
  const { stat: best, perPoint } = bestPetStat(src, b);

  // Readings saved before pet ids were read have none: never let a missing
  // id through (every pet would share it, and one tick would select them all).
  const hasId = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id);
  const rows = [
    ...(hasId(roster.activeId) ? [{ id: roster.activeId, name: pet.name, rarity: pet.rarity, ready: roster.activeStatPointsReady ?? 0, active: true }] : []),
    ...roster.others.filter((o) => hasId(o.id)).map((o) => ({ id: o.id as number, name: o.name, rarity: o.rarity, ready: Math.floor((o.points ?? 0) / 5), active: false })),
  ].filter((r) => r.ready > 0);
  const needsRefresh = !hasId(roster.activeId) && !roster.others.some((o) => hasId(o.id));
  const stratOf = (id: number): PetStrategy => strategy[id] ?? 'best';
  const planOf = (r: (typeof rows)[number]) => petPointPlan(stratOf(r.id), r.ready, best);
  const planText = (q: Quad) =>
    STAT_KEYS.filter((k) => q[k] > 0)
      .map((k) => `+${q[k]} ${STAT_SHORT[k]}`)
      .join(', ') || 'Nothing';
  const totalPoints = rows.reduce((t, r) => t + (stratOf(r.id) === 'skip' ? 0 : r.ready), 0);
  const petsToSpend = rows.filter((r) => stratOf(r.id) !== 'skip').length;
  const running = !!scan?.running;
  const lastSpend = scan && !scan.running && scan.mode === 'spend' && scan.finishedAt ? scan : null;

  const applyTo = (ids: Iterable<number>, st: PetStrategy) => setStrategy((prev) => {
    const next = { ...prev };
    for (const id of ids) next[id] = st;
    return next;
  });
  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const spend = async () => {
    setFailed(null);
    const plan: PetSpendPlanEntry[] = rows
      .filter((r) => stratOf(r.id) !== 'skip')
      .map((r) => ({ petId: r.id, name: r.name, alloc: planOf(r) }));
    try {
      const msg: ExtensionMessage = { type: 'pet-spend-start-requested', plan };
      const res = (await chrome.runtime.sendMessage(msg)) as { started?: boolean; reason?: string } | undefined;
      if (res && res.started === false) setFailed(res.reason ?? "Couldn't start.");
      else setConfirming(false);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section class="st-planner" ref={ref}>
      <div class="st-scan">
        <div class="st-scan__text">
          <b>
            {needsRefresh
              ? 'Press Refresh to plan spending'
              : rows.length
                ? `${rows.length} pets have ${rows.reduce((t, r) => t + r.ready, 0)} stat points ready`
                : 'No pet has stat points ready'}
          </b>
          <span>Every point spent counts toward that pet's courier milestones, whatever the stat. The stat only matters if the pet fights.</span>
          {lastSpend && (
            <span class={lastSpend.error ? 'st-scan__result is-warn' : 'st-scan__result'}>
              {lastSpend.error ?? `Spent on ${lastSpend.spent.length} pets ${ago(lastSpend.finishedAt!, Date.now())}${lastSpend.restored ? `, ${lastSpend.restored} is active again` : ''}.`}
              {lastSpend.spent.length > 0 && ` ${lastSpend.spent.map((x) => `${x.name} ${x.text}`).join('; ')}.`}
              {lastSpend.skipped.length > 0 && ` Skipped: ${lastSpend.skipped.map((x) => `${x.name} (${x.reason})`).join(', ')}.`}
            </span>
          )}
        </div>
        {rows.length > 0 && (
          <button type="button" class="db-btn" aria-expanded={open} onClick={() => setOpen(!open)} disabled={running}>
            {open ? 'Close planner' : 'Plan spending'}
          </button>
        )}
      </div>
      {open && rows.length > 0 && (
        <div class="st-plan">
          <p class="st-plan__advice">
            <b>Advice:</b> spend every pet's points on its best combat stat ({STAT_LABEL[best]} for you, about +{perPoint[best].toFixed(1)} Combat Power a point if
            that pet fights). Couriers gain the same whatever you pick, so this keeps every pet a strong backup at no cost. Even split or one stat only make
            sense if you want a pet balanced or built a certain way.
          </p>
          <div class="st-plan__bulk" role="group" aria-label="Set the selected pets to">
            <label class="st-plan__check">
              <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} /> Select all
            </label>
            <span class="st-plan__bulk-label">{selected.size ? `Set ${selected.size} selected to:` : 'Select pets to set several at once'}</span>
            {selected.size > 0 && (
              <span class="st-plan__bulk-btns">
                <button type="button" class="db-btn" onClick={() => applyTo(selected, 'best')}>Best combat stat</button>
                <button type="button" class="db-btn" onClick={() => applyTo(selected, 'even')}>Even split</button>
                {STAT_KEYS.map((k) => (
                  <button key={k} type="button" class="db-btn" onClick={() => applyTo(selected, k)}>
                    All {STAT_SHORT[k]}
                  </button>
                ))}
                <button type="button" class="db-btn" onClick={() => applyTo(selected, 'skip')}>Don't spend</button>
              </span>
            )}
          </div>
          <div class="st-table-wrap">
            <table class="st-table st-adv">
              <thead>
                <tr>
                  <th scope="col" class="st-plan__cb"><span class="st-sr">Select</span></th>
                  <th scope="col" class="st-rowhead">Pet</th>
                  <th scope="col">Courier milestone</th>
                  <th scope="col">Spend how</th>
                  <th scope="col">Plan</th>
                  <th scope="col" class="st-num" title="Combat Power this adds if the pet is your active one">If it fights</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const q = planOf(r);
                  const m = milestones.get(r.name.toLowerCase());
                  const spentNow = stratOf(r.id) === 'skip' ? 0 : r.ready;
                  return (
                    <tr key={r.id} class={r.active ? 'st-adv__current' : ''}>
                      <td class="st-plan__cb">
                        <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                      </td>
                      <th scope="row" class="st-rowhead">
                        <div class="st-adv__item">
                          <span class="st-adv__name">{r.name}</span>
                          <span class="st-adv__meta">
                            {[r.rarity, r.active ? 'Active now' : null, `${r.ready} stat points ready`].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      </th>
                      <td class="st-plan__ms">
                        {m?.pointsNeededForNextMilestone != null ? (
                          spentNow >= m.pointsNeededForNextMilestone ? (
                            <span class="st-up">
                              Reaches the next one: carries {m.nextMilestoneCapacity ?? m.capacity}
                              {m.nextMilestoneTravelPenaltyPct != null ? `, +${m.nextMilestoneTravelPenaltyPct}% travel` : ''}
                            </span>
                          ) : (
                            <span>{m.pointsNeededForNextMilestone} needed for the next, this spends {spentNow}</span>
                          )
                        ) : (
                          <span class="st-flat" title="Shown on the Smuggling page when no deliveries are out">Not seen yet</span>
                        )}
                      </td>
                      <td>
                        <select
                          class="st-plan__select"
                          aria-label={`How to spend ${r.name}'s points`}
                          value={stratOf(r.id)}
                          onChange={(e) => applyTo([r.id], (e.target as HTMLSelectElement).value as PetStrategy)}
                        >
                          <option value="best">{STRATEGY_LABEL.best} ({STAT_SHORT[best]})</option>
                          <option value="even">{STRATEGY_LABEL.even}</option>
                          {STAT_KEYS.map((k) => (
                            <option key={k} value={k}>
                              All {STAT_LABEL[k]}
                            </option>
                          ))}
                          <option value="skip">{STRATEGY_LABEL.skip}</option>
                        </select>
                      </td>
                      <td class="st-plan__plan">{planText(q)}</td>
                      <td class="st-num">{stratOf(r.id) === 'skip' ? '—' : `+${n(planPower(q, perPoint))}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div class="st-plan__foot">
            {!confirming ? (
              <>
                <span>
                  {petsToSpend ? `Spend ${totalPoints} stat points on ${petsToSpend} pets.` : 'Nothing set to spend.'} Takes about{' '}
                  {Math.max(1, Math.round((petsToSpend * 5.5 + totalPoints * 0.6 + 10) / 60))} min; {pet.name} is put back after.
                </span>
                <button type="button" class="db-btn db-btn--primary" disabled={!petsToSpend || running} onClick={() => setConfirming(true)}>
                  Spend points
                </button>
              </>
            ) : (
              <>
                <span class="st-plan__warn">Spending can't be undone. Spend {totalPoints} points on {petsToSpend} pets as planned?</span>
                <span class="st-plan__confirm">
                  <button type="button" class="db-btn" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                  <button type="button" class="db-btn db-btn--primary" onClick={spend}>
                    Yes, spend them
                  </button>
                </span>
              </>
            )}
          </div>
          {failed && <p class="db-warn">{failed}</p>}
        </div>
      )}
    </section>
  );
}

function PetAdvice({ b, src, openPlanner }: { b: Breakdown; src: StatSources; openPlanner?: boolean }) {
  const [shop, setShop] = useState(false);
  const p = petOptions(src, b);
  if (!p) return <NeedsSource what="the Menagerie's Care tab" />;
  const active = p.options.find((o) => o.status === 'active')!;
  const owned = p.options.filter((o) => o.status === 'owned').sort((x, y) => (y.powerDelta ?? -1e9) - (x.powerDelta ?? -1e9));
  const buy = p.options.filter((o) => o.status === 'shop').sort((x, y) => (y.powerDelta ?? 0) - (x.powerDelta ?? 0)).slice(0, PET_SHOP_ROWS);
  const best = owned[0];
  const even = evenBand(b);
  const rate = bonusRates(b);
  const spend = p.spend && (
    <>
      put its {p.spend.points} stat points into {STAT_LABEL[p.spend.stat]} for about +{n(p.spend.power)}.
    </>
  );
  return (
    <>
      {best && best.powerDelta !== null && best.powerDelta > even ? (
        <Verdict
          head={`${best.name} would add about ${n(best.powerDelta)} Combat Power over your ${active.name}.`}
          body={
            <>
              Set it active on the Menagerie's Care tab. Arena counts it from the next season.{spend && <> If you keep the {active.name}, {spend}</>}
            </>
          }
        />
      ) : (
        <Verdict head={`${active.name} is already your best pet for combat.`} body={spend ? <>Next, {spend}</> : undefined} />
      )}
      <PetScanBar estimated={owned.filter((o) => o.source !== 'remembered').length} total={owned.length} active={active.name} />
      <PetPointsPlanner b={b} src={src} startOpen={openPlanner} />
      <p class="st-table-hint">
        <span class="st-table-hint__base" aria-hidden="true" /> First row: what yours adds now. Other rows: the change if you switched.
      </p>
      <div class="st-table-wrap">
        <table class="st-table st-adv">
          <PetHead label="Your pets" />
          <tbody>
            <PetRow o={active} active rate={rate} />
            {owned.map((o) => (
              <PetRow key={o.name} o={o} rate={rate} />
            ))}
          </tbody>
        </table>
      </div>
      <p class="db-note">
        The game only shows a pet's stats while it's active, so the extension remembers each pet's real stats every time it reads your Care tab. Pets it
        hasn't seen active yet use the wiki's base stats, which leave out your training; set one active once to replace the estimate. Unspent points (5
        buy a stat point) can only be spent while a pet is active. Only the active pet counts in fights.
      </p>
      <button type="button" class="st-linkbtn st-more" aria-expanded={shop} onClick={() => setShop(!shop)}>
        {shop ? 'Hide pets you could buy' : 'Show pets you could buy'}
      </button>
      {shop && (
        <div class="st-table-wrap st-gap">
          <table class="st-table st-adv">
            <PetHead label="Pets you could buy" />
            <tbody>
              {buy.map((o) => (
                <PetRow key={o.name} o={o} rate={rate} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// Bonuses

const CAREER_ROWS = 8;
const STATUS_LABEL: Record<GainStatus, string> = { now: 'Take now', progress: 'Work shifts', blocked: 'Need more', later: 'Later' };

function bonusSummary(b: Breakdown, src: StatSources): { status: string } | null {
  if (!src.academy && !src.bloodline && !src.careers) return null;
  const now = bonusGains(src, b).filter((g) => g.status === 'now' && (g.power ?? 0) >= 1);
  return { status: now.length ? `${now.length} to take now` : 'Nothing right now' };
}

function GainRow({ g }: { g: Gain }) {
  const [open, setOpen] = useState(false);
  return (
    <li class={`st-gain st-gain--${g.status}`}>
      <div class="st-gain__main">
        <div class="st-gain__what">
          <span class="st-gain__title">{g.title}</span>
          <span class="st-gain__effect">{g.effect}</span>
        </div>
        <div class="st-gain__value">
          {g.power !== null ? (
            <span class={g.power >= 1 ? 'st-up' : 'st-flat'} title="Estimated Combat Power">+{n(g.power)}</span>
          ) : (
            <span class="st-tag st-tag--info" title="Changes fights, not the four stats">fight bonus</span>
          )}
        </div>
      </div>
      <div class="st-gain__meta">
        <span class={`st-gain__status st-gain__status--${g.status}`}>{STATUS_LABEL[g.status]}</span>
        <span>{g.when}</span>
        {g.cost && <span>{g.cost}</span>}
        {g.choices && g.choices.length > 1 && (
          <button type="button" class="st-linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide choices' : `All ${g.choices.length} choices`}
          </button>
        )}
      </div>
      {open && g.choices && (
        <ul class="st-choices">
          {g.choices.map((c) => (
            <li key={c.name}>
              <span>
                {c.name}: {c.effect}
              </span>
              <span>{c.power !== null ? `+${n(c.power)}` : '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function GainGroup({
  title,
  note,
  gains,
  limit,
  empty,
  controls,
}: {
  title: string;
  note: string;
  gains: Gain[];
  limit?: number;
  empty: ComponentChildren;
  controls?: ComponentChildren;
}) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? gains.slice(0, limit) : gains;
  return (
    <section class="st-group">
      <header class="st-group__head">
        <div class="st-group__text">
          <h3 class="st-group__title">{title}</h3>
          <p class="st-group__note">{note}</p>
        </div>
        {controls}
      </header>
      {gains.length === 0 ? (
        <p class="db-empty">{empty}</p>
      ) : (
        <ul class="st-gains">
          {shown.map((g) => (
            <GainRow key={`${g.source}-${g.title}`} g={g} />
          ))}
        </ul>
      )}
      {limit && gains.length > limit && (
        <button type="button" class="st-linkbtn st-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${gains.length}`}
        </button>
      )}
    </section>
  );
}

const CAREER_SORT_KEY = 'ff-stats-career-sort';

/** Sort switch for the Careers list; the choice is remembered per browser. */
function useCareerSort(): [CareerSort, (s: CareerSort) => void] {
  const [sort, setSort] = useState<CareerSort>(() => {
    try {
      return localStorage.getItem(CAREER_SORT_KEY) === 'gain' ? 'gain' : 'shifts';
    } catch {
      return 'shifts';
    }
  });
  const pick = (v: CareerSort) => {
    setSort(v);
    try {
      localStorage.setItem(CAREER_SORT_KEY, v);
    } catch {
      /* per-viewer convenience only */
    }
  };
  return [sort, pick];
}

function SortSwitch({ value, onChange }: { value: CareerSort; onChange: (v: CareerSort) => void }) {
  const opts: { id: CareerSort; label: string }[] = [
    { id: 'shifts', label: 'Fewest shifts' },
    { id: 'gain', label: 'Biggest gain' },
  ];
  return (
    <div class="st-seg-switch" role="radiogroup" aria-label="Sort careers by">
      {opts.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} class={value === o.id ? 'is-on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BonusAdvice({ b, src }: { b: Breakdown; src: StatSources }) {
  const [careerSort, setCareerSort] = useCareerSort();
  if (!src.academy && !src.bloodline && !src.careers) return <NeedsSource what="the Academy, Bloodline and Careers pages" />;
  const gains = bonusGains(src, b);
  const by = (source: Gain['source']) => gains.filter((g) => g.source === source);
  const academy = by('Academy');
  const takeNow = academy.filter((g) => g.status === 'now' && (g.power ?? 0) >= 1);
  const top = takeNow[0];
  const careerNear = by('Career').filter((g) => g.nextRank);
  return (
    <>
      {top ? (
        <Verdict
          head={`Start ${top.title.split(': ')[1] ?? top.title} at the Academy: about +${n(top.power ?? 0)} Combat Power.`}
          body={`${top.effect} for ${top.cost ?? 'its tuition'}. ${takeNow.length > 1 ? `${takeNow.length - 1} more combat courses are open after it.` : ''}`}
        />
      ) : careerNear[0] ? (
        <Verdict head={`${careerNear[0].title} is your closest combat reward: about +${n(careerNear[0].power ?? 0)}.`} body={careerNear[0].when} />
      ) : (
        <Verdict head="No combat bonus is ready to take right now." body="The lists below show what opens next." />
      )}
      <div class="st-groups">
        <GainGroup
          title="Academy"
          note="The next course in each combat lane."
          gains={academy}
          empty={src.academy ? 'Every combat course is done.' : 'Open the Academy or press Refresh.'}
        />
        <GainGroup
          title="Bloodline"
          note={`Tiers you haven't taken, plus the next ones your level unlocks.${src.bloodline?.lpAvailable !== null && src.bloodline?.lpAvailable !== undefined ? ` You have ${src.bloodline.lpAvailable} LP.` : ''}`}
          gains={by('Bloodline')}
          empty={src.bloodline ? 'No combat nodes left to take for now.' : 'Open the Bloodline page or press Refresh.'}
        />
        <GainGroup
          title="Careers"
          note={
            careerSort === 'shifts'
              ? 'Combat rewards from career ranks, fewest shifts first. The game only shows the count to your next rank, so rewards further up come after.'
              : 'Combat rewards from career ranks, biggest gain first.'
          }
          controls={<SortSwitch value={careerSort} onChange={setCareerSort} />}
          gains={sortCareers(by('Career'), careerSort)}
          limit={CAREER_ROWS}
          empty={src.careers ? 'No combat rewards left in your careers.' : 'Open the Careers page or press Refresh.'}
        />
      </div>
      <p class="db-note">
        Power is an estimate: a "+X% Strength" bonus adds about X% of your Strength before percentage bonuses; gear and pet % bonuses add to that source only.
        Fight bonuses (damage, block, crit damage...) change fights, not the four stats. Arena picks up changes at the next season start.
      </p>
    </>
  );
}

type AdvisorTab = 'car' | 'pet' | 'bonuses';

function Advisor({ b, src, focus }: { b: Breakdown; src: StatSources; focus: string | null }) {
  const [tab, setTab] = useState<AdvisorTab>(() => {
    if (focus === 'pet-planner') return 'pet';
    try {
      const v = localStorage.getItem('ff-stats-advisor-tab');
      return v === 'pet' || v === 'bonuses' ? v : 'car';
    } catch {
      return 'car';
    }
  });
  const pick = (t: AdvisorTab) => {
    setTab(t);
    try {
      localStorage.setItem('ff-stats-advisor-tab', t);
    } catch {
      /* per-viewer convenience only */
    }
  };
  const tabs: { id: AdvisorTab; label: string; status: string | null }[] = [
    { id: 'car', label: 'Car', status: carSummary(b, src)?.status ?? null },
    { id: 'pet', label: 'Pet', status: petSummary(b, src)?.status ?? null },
    { id: 'bonuses', label: 'Bonuses', status: bonusSummary(b, src)?.status ?? null },
  ];
  return (
    <section class="db-card st-advisor">
      <div class="st-subtabs" role="tablist" aria-label="Advice">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`st-adv-${t.id}`} aria-selected={tab === t.id} aria-controls="st-adv-panel" class={`st-subtab${tab === t.id ? ' is-active' : ''}`} onClick={() => pick(t.id)}>
            <span class="st-subtab__label">{t.label}</span>
            <span class={`st-subtab__status${t.status?.startsWith('+') || /to take|to spend/.test(t.status ?? '') ? ' is-gain' : ''}`}>{t.status ?? 'Not read yet'}</span>
          </button>
        ))}
      </div>
      <div class="st-advisor__panel" id="st-adv-panel" role="tabpanel" aria-labelledby={`st-adv-${tab}`}>
        {tab === 'car' ? <CarAdvice b={b} src={src} /> : tab === 'pet' ? <PetAdvice b={b} src={src} openPlanner={focus === 'pet-planner'} /> : <BonusAdvice b={b} src={src} />}
      </div>
    </section>
  );
}

type View = 'breakdown' | 'advisor';

/** "#/stats?pet-planner" (the Menagerie Assistant's link): open Advisor → Pet
 *  with the points planner open. The hint is then removed from the address
 *  (a reload shouldn't reopen it); the counter makes a second click reopen the
 *  planner even if the player closed it in between. */
function useFocusRequest(): { name: string | null; n: number } {
  const read = () => {
    const i = location.hash.indexOf('?');
    return i === -1 ? null : location.hash.slice(i + 1) || null;
  };
  const [focus, setFocus] = useState(() => ({ name: read(), n: 0 }));
  useEffect(() => {
    const take = () => {
      const name = read();
      if (!name) return;
      setFocus((f) => ({ name, n: f.n + 1 }));
      history.replaceState(null, '', location.hash.split('?')[0]);
    };
    take();
    window.addEventListener('hashchange', take);
    return () => window.removeEventListener('hashchange', take);
  }, []);
  return focus;
}

export function StatsSection() {
  const src = useSources();
  const now = useNow();
  const focus = useFocusRequest();
  useEffect(() => {
    if (focus.name === 'pet-planner') setView('advisor');
  }, [focus.n]);
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem('ff-stats-view') as View) === 'advisor' ? 'advisor' : 'breakdown';
    } catch {
      return 'breakdown';
    }
  });
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('ff-stats-view', v);
    } catch {
      /* per-viewer convenience only */
    }
  };
  if (!src) return <p class="db-empty">Loading…</p>;
  const b = buildBreakdown(src);
  return (
    <div class="st">
      <Toolbar src={src} now={now} />
      {!b ? (
        <section class="db-card st-empty">
          <h2 class="db-h">No stats yet</h2>
          <p class="db-p">Press <b>Refresh</b> to read your stats from the game, or open the Gym in the game.</p>
        </section>
      ) : (
        <>
          <div class="st-views" role="tablist" aria-label="Stats view">
            {(['breakdown', 'advisor'] as View[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} class={`st-view${view === v ? ' is-active' : ''}`} onClick={() => pick(v)}>
                {v === 'breakdown' ? 'Breakdown' : 'Advisor'}
              </button>
            ))}
          </div>
          {view === 'breakdown' ? (
            <>
              <Legend b={b} />
              <StatCards b={b} src={src} />
              <div class="db-grid">
                <SourcesTable b={b} src={src} />
                <PercentBonuses b={b} src={src} />
                <FightBonuses src={src} />
                <HowItWorks />
              </div>
            </>
          ) : (
            <Advisor key={`focus-${focus.n}`} b={b} src={src} focus={focus.name} />
          )}
        </>
      )}
    </div>
  );
}
