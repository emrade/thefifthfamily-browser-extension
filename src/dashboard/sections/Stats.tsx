import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
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
import { bonusRates, vehicleOptions, type VehicleOption } from '@/shared/statAdvisor';

/**
 * Dashboard → Stats: where each of the four combat stats comes from, read
 * from the game's own pages (see shared/statBreakdown.ts). The Refresh button
 * reads those pages once; otherwise it updates as the player opens them.
 */

const STAT_LABEL: Record<StatKey, string> = { str: 'Strength', def: 'Defence', agi: 'Agility', dex: 'Dexterity' };
const STAT_SHORT: Record<StatKey, string> = { str: 'STR', def: 'DEF', agi: 'AGI', dex: 'DEX' };
const SOURCE_KEYS = [STORAGE_KEYS.STAT_SRC_GYM, STORAGE_KEYS.STAT_SRC_GEAR, STORAGE_KEYS.STAT_SRC_PET, STORAGE_KEYS.STAT_SRC_CAR, STORAGE_KEYS.STAT_SRC_LOADOUT];
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

const SOURCE_ROWS: { key: keyof StatSources; label: string; where: string }[] = [
  { key: 'gym', label: 'Gym', where: 'the Gym' },
  { key: 'gear', label: 'Inventory', where: 'your Inventory' },
  { key: 'pet', label: 'Menagerie', where: 'the Menagerie → Care tab' },
  { key: 'car', label: 'Chop Shop', where: 'the Chop Shop' },
  { key: 'loadout', label: 'Arena lock-in', where: 'the Arena at the start of a season' },
];
const REFRESHABLE: Partial<Record<keyof StatSources, keyof StatRefreshResult['errors']>> = { gym: 'gym', gear: 'gear', pet: 'pet', car: 'car' };

function Toolbar({ src, now }: { src: StatSources; now: number }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StatRefreshResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

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

  return (
    <section class="st-toolbar" aria-label="Data sources">
      <div class="st-toolbar__lead">
        <button type="button" class="db-btn db-btn--primary st-refresh" onClick={refresh} disabled={busy} aria-busy={busy}>
          {busy ? 'Reading the game…' : 'Refresh'}
        </button>
        <p class="st-toolbar__hint">Reads the Gym, Inventory, Menagerie and Chop Shop once. Also updates whenever you open those pages.</p>
      </div>
      <ul class="st-sources">
        {SOURCE_ROWS.map((row) => {
          const snap = src[row.key];
          const err = result && REFRESHABLE[row.key] ? result.errors[REFRESHABLE[row.key]!] : undefined;
          // A failed refresh keeps the earlier reading: say so, and keep the
          // reason for the hover rather than shouting it.
          const state = err ? (snap ? 'stale' : 'error') : !snap ? 'missing' : row.key !== 'loadout' && now - snap.at > DAY_MS ? 'stale' : 'ok';
          const when = err ? (snap ? `kept from ${ago(snap.at, now)}` : err) : snap ? ago(snap.at, now) : 'not read yet';
          const title = err ? `Not updated: ${err}${snap ? `. Showing the reading from ${stamp(snap.at)}.` : ''}` : snap ? `Read ${stamp(snap.at)}` : `Open ${row.where} to fill this in`;
          return (
            <li key={row.key} class={`st-source st-source--${state}`} title={title}>
              <span class="st-source__dot" aria-hidden="true" />
              <span class="st-source__name">{row.label}</span>
              <span class="st-source__when">{when}</span>
            </li>
          );
        })}
      </ul>
      {failed && <p class="db-warn">Refresh failed: {failed}</p>}
      {result && Object.keys(result.errors).length > 0 && (
        <ul class="st-refresh-notes">
          {SOURCE_ROWS.filter((r) => REFRESHABLE[r.key] && result.errors[REFRESHABLE[r.key]!]).map((r) => (
            <li key={r.key}>
              <b>{r.label}:</b> {result.errors[REFRESHABLE[r.key]!]}
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

const VEHICLE_ROWS = 6;
const signed = (v: number) => (Math.round(v) > 0 ? `+${n(v)}` : Math.round(v) === 0 ? '0' : `−${n(Math.abs(v))}`);
const money = (v: number) => (v >= 1e6 ? `$${Number((v / 1e6).toFixed(1))}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${v}`);

function Delta({ v }: { v: number }) {
  const r = Math.round(v);
  return <span class={r > 0 ? 'st-up' : r < 0 ? 'st-down' : 'st-flat'}>{signed(v)}</span>;
}

function verdict(opts: VehicleOption[], current: VehicleOption | undefined, power: number): { head: string; body: string } {
  const others = opts.filter((o) => o.status !== 'equipped');
  const best = [...others].sort((a, b) => b.powerDelta - a.powerDelta)[0];
  const even = Math.max(10, power * 0.005);
  const name = current?.name ?? 'Your car';
  if (!best || best.powerDelta <= even) {
    const close = others.filter((o) => Math.abs(o.powerDelta) <= even);
    return {
      head: `${name} is already your best car for combat.`,
      body: close.length
        ? `${close.map((o) => o.name).join(' and ')} come${close.length === 1 ? 's' : ''} out about even: the same total, spread differently across the stats.`
        : `No car you own or can buy adds more to your stats.`,
    };
  }
  return {
    head: `${best.name} would add about ${n(best.powerDelta)} Combat Power.`,
    body: best.status === 'dealer' ? `It costs ${money(best.priceCash)} at the dealer.` : 'You already own it.',
  };
}

function RaceCell({ o, cur }: { o: VehicleOption; cur: VehicleOption | undefined }) {
  const parts: [string, number, number | undefined][] = [
    ['Speed', o.race.speed, cur?.race.speed],
    ['Accel', o.race.accel, cur?.race.accel],
    ['Handling', o.race.handling, cur?.race.handling],
  ];
  return (
    <span class="st-race" title={parts.map(([l, v]) => `${l} ${v}`).join(' · ')}>
      {parts.map(([l, v, c]) => (
        <span key={l} class={c === undefined || o.status === 'equipped' || v === c ? '' : v > c ? 'st-up' : 'st-down'}>{v}</span>
      ))}
    </span>
  );
}

function VehicleAdvisor({ b, src }: { b: Breakdown; src: StatSources }) {
  const [all, setAll] = useState(false);
  const opts = vehicleOptions(src, b);
  if (!opts) {
    return (
      <section class="db-card db-card--wide">
        <h2 class="db-h">Best car for your stats</h2>
        <p class="db-empty">Press Refresh (or open the Chop Shop in the game) to read your garage and the dealer.</p>
      </section>
    );
  }
  const current = opts.find((o) => o.status === 'equipped');
  const power = STAT_KEYS.reduce((s, k) => s + b.total[k], 0);
  const v = verdict(opts, current, power);
  const rate = bonusRates(b);
  const ranked = [current, ...opts.filter((o) => o.status !== 'equipped').sort((a, z) => z.powerDelta - a.powerDelta)].filter(Boolean) as VehicleOption[];
  const shown = all ? ranked : ranked.slice(0, VEHICLE_ROWS);

  return (
    <section class="db-card db-card--wide">
      <h2 class="db-h">Best car for your stats</h2>
      <div class="st-verdict">
        <p class="st-verdict__head">{v.head}</p>
        <p class="st-verdict__body">{v.body}</p>
      </div>
      <div class="st-table-wrap">
        <table class="st-table st-adv">
          <thead>
            <tr>
              <th scope="col" class="st-rowhead">Car</th>
              {STAT_KEYS.map((k) => (
                <th key={k} scope="col" class={`st-num st-th--${k}`}>{STAT_SHORT[k]}</th>
              ))}
              <th scope="col" class="st-num">Combat Power</th>
              <th scope="col" class="st-num" title="Racing speed, acceleration and handling">Racing</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.name} class={o.status === 'equipped' ? 'st-adv__current' : ''}>
                <th scope="row" class="st-rowhead">
                  <div class="st-adv__car">
                    <span class="st-adv__name">{o.name}</span>
                    <span class="st-adv__meta">
                      {o.status === 'equipped' ? 'Equipped' : o.status === 'owned' ? 'Owned' : money(o.priceCash)}
                      {o.vehicleClass && ` · Class ${o.vehicleClass}`}
                    </span>
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
                  <td key={k} class="st-num" title={`Car gives ${o.stats[k]} ${STAT_SHORT[k]}`}>
                    {o.status === 'equipped' ? n(o.stats[k] * rate[k]) : <Delta v={o.delta[k]} />}
                  </td>
                ))}
                <td class="st-num st-adv__power">{o.status === 'equipped' ? '—' : <Delta v={o.powerDelta} />}</td>
                <td class="st-num"><RaceCell o={o} cur={current} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ranked.length > VEHICLE_ROWS && (
        <button type="button" class="db-btn st-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${ranked.length} cars`}
        </button>
      )}
      <p class="db-note">
        Your car's row shows what it adds now, after your bonuses. Other rows show the change if you equipped that car instead, estimated with
        your own bonus rate for each stat (STR ×{rate.str.toFixed(2)}, DEF ×{rate.def.toFixed(2)}, AGI ×{rate.agi.toFixed(2)}, DEX ×{rate.dex.toFixed(2)}).
        Racing shows speed, acceleration and handling, green or red against your current car. Arena only picks up a change at the next season start.
      </p>
    </section>
  );
}

function ComingNext({ src }: { src: StatSources }) {
  return (
    <section class="db-card db-card--wide">
      <h2 class="db-h">Coming next</h2>
      <ul class="db-plain st-how">
        <li><b>Pets:</b> which pet adds the most once trained, and what the active one gives up (courier and perk effects).</li>
        <li>
          <b>Bonuses you could still get:</b> Career ranks, Bloodline perks and Academy courses you haven't taken, and what each would add.
          {!src.loadout && ' This needs the bonus list from the Arena lock-in.'}
        </li>
      </ul>
    </section>
  );
}

type View = 'breakdown' | 'advisor';

export function StatsSection() {
  const src = useSources();
  const now = useNow();
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
            <div class="db-grid">
              <VehicleAdvisor b={b} src={src} />
              <ComingNext src={src} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
