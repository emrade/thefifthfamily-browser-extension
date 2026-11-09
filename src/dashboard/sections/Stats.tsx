import { Fragment } from 'preact';
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
  trained: 'What you have trained at the Gym.',
  gear: 'Your 7 equipped items, forge levels included.',
  car: 'Your equipped car adds the same amount to every stat.',
  pet: 'Only your active pet counts, with its own bonuses applied.',
  vigilantes: 'Flat points from V2 Vigilantes, from the Arena lock-in.',
  bonus: 'What your percentage bonuses add on top: the game total minus everything above.',
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
          const state = err ? 'error' : !snap ? 'missing' : row.key !== 'loadout' && now - snap.at > DAY_MS ? 'stale' : 'ok';
          return (
            <li key={row.key} class={`st-source st-source--${state}`} title={snap ? `Read ${stamp(snap.at)}` : `Open ${row.where} to fill this in`}>
              <span class="st-source__dot" aria-hidden="true" />
              <span class="st-source__name">{row.label}</span>
              <span class="st-source__when">{err ? err : snap ? ago(snap.at, now) : 'not read yet'}</span>
            </li>
          );
        })}
      </ul>
      {failed && <p class="db-warn">Refresh failed: {failed}</p>}
    </section>
  );
}

// ── Stat cards ─────────────────────────────────────────────────────────

function Composition({ b, k }: { b: Breakdown; k: StatKey }) {
  const segs: { key: PartKey; label: string; value: number }[] = [
    ...b.parts.map((p) => ({ key: p.key as PartKey, label: p.label, value: p.values[k] })),
    { key: 'bonus' as const, label: 'Bonuses', value: b.bonus[k] },
  ].filter((s) => s.value > 0);
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  const label = segs.map((s) => `${s.label} ${n(s.value)}`).join(', ');
  return (
    <div class="st-bar" role="img" aria-label={`${STAT_LABEL[k]}: ${label}`}>
      {segs.map((s) => (
        <span key={s.key} class={`st-seg st-seg--${s.key}`} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${n(s.value)} (${Math.round((s.value / total) * 100)}%)`} />
      ))}
    </div>
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
    <div class="st-cards">
      {STAT_KEYS.map((k) => {
        const fx = effect(src, k);
        const diff = locked ? b.total[k] - locked[k] : 0;
        return (
          <article key={k} class={`st-card st-card--${k}`} aria-label={STAT_LABEL[k]}>
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
                'Arena value appears at the next season lock-in'
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

function Cells({ q, cls }: { q: Quad; cls?: string }) {
  return (
    <>
      {STAT_KEYS.map((k) => (
        <td key={k} class={`db-mono st-num ${cls ?? ''}`}>{n(q[k])}</td>
      ))}
    </>
  );
}

function SourcesTable({ b, src, now }: { b: Breakdown; src: StatSources; now: number }) {
  const [openGear, setOpenGear] = useState(false);
  const flat: Quad = { str: 0, def: 0, agi: 0, dex: 0 };
  for (const p of b.parts) for (const k of STAT_KEYS) flat[k] += p.values[k];

  return (
    <section class="db-card db-card--wide">
      <h2 class="db-h">Where your stats come from</h2>
      <div class="st-table-wrap">
        <table class="db-table st-table">
          <thead>
            <tr>
              <th scope="col">Source</th>
              {STAT_KEYS.map((k) => (
                <th key={k} scope="col" class={`st-num st-th--${k}`}>{STAT_SHORT[k]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.parts.map((p) => (
              <Fragment key={p.key}>
                <tr>
                  <th scope="row" class="st-src">
                    <span class={`st-swatch st-seg--${p.key}`} aria-hidden="true" />
                    <span class="st-src__text">
                      {p.key === 'gear' ? (
                        <button type="button" class="st-expand" aria-expanded={openGear} onClick={() => setOpenGear(!openGear)}>
                          <span class="st-caret" aria-hidden="true">{openGear ? '▾' : '▸'}</span> {p.label} ({src.gear?.items.length ?? 0} items)
                        </button>
                      ) : (
                        p.label
                      )}
                      <span class="st-src__hint">{PART_HINT[p.key]} <span class="st-src__when">Read {ago(p.at, now)}.</span></span>
                    </span>
                  </th>
                  <Cells q={p.values} />
                </tr>
                {p.key === 'gear' && openGear && src.gear && (
                  <>
                    {src.gear.items.map((it) => (
                      <tr key={it.name} class="st-sub">
                        <th scope="row" class="st-src st-src--sub">
                          {it.name} <span class="st-enh">+{it.enhancement}</span> <span class="st-slot">{it.slot}</span>
                        </th>
                        <Cells q={it.stats} />
                      </tr>
                    ))}
                    {src.gear.shownExtra && (
                      <tr class="st-sub">
                        <th scope="row" class="st-src st-src--sub">
                          Gear bonus shown on the inventory page <span class="st-slot">source not labelled by the game</span>
                        </th>
                        <Cells q={src.gear.shownExtra} />
                      </tr>
                    )}
                  </>
                )}
              </Fragment>
            ))}
            <tr class="st-subtotal">
              <th scope="row" class="st-src">Before percentage bonuses</th>
              <Cells q={flat} />
            </tr>
            <tr>
              <th scope="row" class="st-src">
                <span class="st-swatch st-seg--bonus" aria-hidden="true" />
                <span class="st-src__text">
                  Percentage bonuses
                  <span class="st-src__hint">{PART_HINT.bonus}</span>
                </span>
              </th>
              {STAT_KEYS.map((k) => (
                <td key={k} class="db-mono st-num">
                  +{n(b.bonus[k])}
                  {flat[k] > 0 && <span class="st-pctof">+{Math.round((b.bonus[k] / flat[k]) * 100)}%</span>}
                </td>
              ))}
            </tr>
            <tr class="st-total">
              <th scope="row" class="st-src">Total (Gym page)</th>
              <Cells q={b.total} />
            </tr>
          </tbody>
        </table>
      </div>
      {b.missing.length > 0 && (
        <p class="db-warn">
          Not read yet: {b.missing.join(', ')}. Until then their share is counted in "Percentage bonuses".
        </p>
      )}
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

export function StatsSection() {
  const src = useSources();
  const now = useNow();
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
          <StatCards b={b} src={src} />
          <div class="db-grid">
            <SourcesTable b={b} src={src} now={now} />
            <PercentBonuses b={b} src={src} />
            <FightBonuses src={src} />
            <HowItWorks />
          </div>
        </>
      )}
    </div>
  );
}
