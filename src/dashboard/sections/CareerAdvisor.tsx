import { useEffect, useMemo, useState } from 'preact/hooks';
import { STORAGE_KEYS } from '@/shared/constants';
import { storage } from '@/shared/storage';
import type { ExtensionMessage } from '@/shared/messaging';
import type { CareersSnapshot } from '@/shared/statAdvisorSources';
import type { CareerAutoConfig, CareerGoal, CareerGoalsConfig, CareerGoalsStatus } from '@/shared/types';
import {
  estimate, familyShort, formatHours, formatPerkValue, goalState, perkRows, perkTextAt, perkTotals,
  type Live, type PerkRow, type PerkTotal,
} from '@/shared/careerAdvisor';

/**
 * Dashboard → Career Advisor: find the jobs that give a perk, see what the
 * careers already give, and queue "job → rank" goals for Career Auto. Data:
 * the Careers page (refreshed on open, and by Career Auto every cycle). See
 * docs/career-advisor-plan.md.
 */

type Tab = 'finder' | 'totals' | 'goals';

const LS = {
  tab: 'ff-career-advisor-tab',
  perks: 'ff-career-advisor-perks',
  filters: 'ff-career-advisor-filters',
};

function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* per-viewer convenience only */
  }
}

function useStored<T>(key: string, load: () => Promise<T>): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    load().then(setV);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && key in changes) load().then(setV);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return v;
}

function ago(at: number): string {
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function CareerAdvisorSection() {
  const snapshot = useStored<CareersSnapshot | null>(STORAGE_KEYS.STAT_SRC_CAREERS, () => storage.getStatSourceCareers());
  const goals = useStored<CareerGoalsConfig>(STORAGE_KEYS.CAREER_GOALS_CONFIG, () => storage.getCareerGoalsConfig());
  const goalStatus = useStored<CareerGoalsStatus>(STORAGE_KEYS.CAREER_GOALS_STATUS, () => storage.getCareerGoalsStatus());
  const auto = useStored<CareerAutoConfig>(STORAGE_KEYS.CAREER_AUTO_CONFIG, () => storage.getCareerAutoConfig());
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(() => lsGet<Tab>(LS.tab, 'finder'));

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = (await chrome.runtime.sendMessage({ type: 'career-advisor-refresh-requested' } satisfies ExtensionMessage)) as {
        live: Live | null;
        error: string | null;
      };
      if (res?.live) setLive(res.live);
      setError(res?.error ?? (res?.live ? null : "Couldn't read your energy and level."));
    } catch {
      setError('Could not reach the background service. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const rows = useMemo(() => perkRows(snapshot, live), [snapshot, live]);
  const totals = useMemo(() => perkTotals(rows), [rows]);

  const pick = (t: Tab) => {
    setTab(t);
    lsSet(LS.tab, t);
  };

  if (!goals || !goalStatus || !auto) return null;

  const tabs: { id: Tab; label: string; status: string }[] = [
    { id: 'finder', label: 'Perk finder', status: `${totals.length} perks across ${snapshot?.jobs.length ?? 0} jobs` },
    { id: 'totals', label: 'Perk totals', status: `${rows.filter((r) => r.earned).length} perks earned` },
    {
      id: 'goals',
      label: 'Goals',
      status: goals.goals.length ? `${goals.goals.length} queued · goal mode ${goals.enabled ? 'on' : 'off'}` : 'No goals yet',
    },
  ];

  return (
    <>
      <section class="st-toolbar" aria-label="Data">
        <div class="st-toolbar__lead">
          <button type="button" class="db-btn db-btn--primary" onClick={refresh} disabled={busy} aria-busy={busy}>
            {busy ? 'Reading…' : 'Refresh'}
          </button>
          <div class="st-toolbar__status">
            <p class="st-toolbar__line">
              {snapshot ? `Careers page read ${ago(snapshot.at)}` : 'Careers page not read yet'}
              {live && ` · Level ${live.level} · Energy ${live.energy}/${live.maxEnergy} · +1 every ${live.energyRegenSeconds}s`}
            </p>
            <p class="st-toolbar__hint">Career Auto also re-reads the page every check while it runs.</p>
          </div>
        </div>
      </section>
      {error && <p class="db-warn">{error}</p>}

      <section class="db-card st-advisor ca-advisor">
        <div class="st-subtabs" role="tablist" aria-label="Career Advisor">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`ca-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="ca-panel"
              class={`st-subtab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => pick(t.id)}
            >
              <span class="st-subtab__label">{t.label}</span>
              <span class="st-subtab__status">{t.status}</span>
            </button>
          ))}
        </div>
        <div class="st-advisor__panel" id="ca-panel" role="tabpanel" aria-labelledby={`ca-tab-${tab}`}>
          {!snapshot ? (
            <p class="db-empty">Press Refresh, or open the Careers page in the game.</p>
          ) : tab === 'finder' ? (
            <PerkFinder rows={rows} totals={totals} goals={goals} auto={auto} live={live} />
          ) : tab === 'totals' ? (
            <PerkTotals totals={totals} />
          ) : (
            <Goals goals={goals} status={goalStatus} auto={auto} snapshot={snapshot} live={live} />
          )}
        </div>
      </section>
    </>
  );
}

// ── Perk finder ─────────────────────────────────────────────────────────

type SortKey = 'value' | 'shifts' | 'energy' | 'regen' | 'fastest' | 'level';

interface Filters {
  hideEarned: boolean;
  hideLocked: boolean;
  family: string;
  sort: SortKey;
  desc: boolean;
}

const DEFAULT_FILTERS: Filters = { hideEarned: true, hideLocked: false, family: 'all', sort: 'regen', desc: false };

function sortValue(r: PerkRow, key: SortKey): number {
  switch (key) {
    case 'value':
      return r.perk.value;
    case 'shifts':
      return r.est.shifts;
    case 'energy':
      return r.est.energy ?? Infinity;
    case 'regen':
      return r.est.regenHours ?? Infinity;
    case 'fastest':
      return r.est.fastestHours ?? Infinity;
    case 'level':
      return r.job.level ?? 0;
  }
}

async function addGoal(config: CareerGoalsConfig, goal: CareerGoal): Promise<void> {
  const fresh = await storage.getCareerGoalsConfig();
  const existing = fresh.goals.find((g) => g.careerId === goal.careerId);
  const goals = existing
    ? fresh.goals.map((g) => (g.careerId === goal.careerId ? { ...g, targetRank: Math.max(g.targetRank, goal.targetRank) as CareerGoal['targetRank'] } : g))
    : [...fresh.goals, goal];
  await storage.setCareerGoalsConfig({ ...config, ...fresh, goals });
}

function PerkFinder({ rows, totals, goals, auto, live }: { rows: PerkRow[]; totals: PerkTotal[]; goals: CareerGoalsConfig; auto: CareerAutoConfig; live: Live | null }) {
  const [selected, setSelected] = useState<string[]>(() => lsGet<string[]>(LS.perks, []));
  const [search, setSearch] = useState('');
  const [f, setF] = useState<Filters>(() => ({ ...DEFAULT_FILTERS, ...lsGet<Partial<Filters>>(LS.filters, {}) }));
  const [confirmRun, setConfirmRun] = useState<number | null>(null);

  const setFilters = (next: Partial<Filters>) => {
    const merged = { ...f, ...next };
    setF(merged);
    lsSet(LS.filters, merged);
  };
  const toggle = (label: string) => {
    const next = selected.includes(label) ? selected.filter((s) => s !== label) : [...selected, label];
    setSelected(next);
    lsSet(LS.perks, next);
  };

  const families = [...new Set(rows.map((r) => familyShort(r.job.family)))].sort();
  const options = totals
    .filter((t) => !search || t.label.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.label.localeCompare(b.label));

  const shown = rows
    .filter((r) => selected.includes(r.perk.label))
    .filter((r) => !(f.hideEarned && r.earned))
    .filter((r) => !(f.hideLocked && r.locked && !r.earned))
    .filter((r) => f.family === 'all' || familyShort(r.job.family) === f.family)
    .sort((a, b) => {
      // Earned last, then level-locked, then the chosen column.
      const group = (r: PerkRow) => (r.earned ? 2 : r.locked ? 1 : 0);
      if (group(a) !== group(b)) return group(a) - group(b);
      const d = sortValue(a, f.sort) - sortValue(b, f.sort);
      return (f.desc ? -d : d) || b.perk.value - a.perk.value;
    });

  const head = (key: SortKey, label: string, title?: string) => (
    <th scope="col" class={key === 'value' ? undefined : 'st-num'} aria-sort={f.sort === key ? (f.desc ? 'descending' : 'ascending') : 'none'} title={title}>
      <button type="button" class="ca-sort" onClick={() => setFilters(f.sort === key ? { desc: !f.desc } : { sort: key, desc: key === 'value' })}>
        {label}
        <span aria-hidden="true">{f.sort === key ? (f.desc ? ' ▾' : ' ▴') : ''}</span>
      </button>
    </th>
  );

  async function runNow(r: PerkRow) {
    await storage.setCareerAutoConfig({
      ...(await storage.getCareerAutoConfig()),
      careerId: r.job.id,
      careerName: r.job.name,
      energyCost: r.job.energy ?? auto.energyCost,
      otEnergyCost: r.job.otEnergy ?? null,
    });
    setConfirmRun(null);
  }

  return (
    <>
      <div class="ca-picker">
        <input
          type="search"
          class="db-input ca-search"
          placeholder="Search perks"
          aria-label="Search perks"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
        <div class="ca-chips" role="group" aria-label="Perks to show">
          {options.map((t) => (
            <button
              key={t.label}
              type="button"
              class={`ca-chip${selected.includes(t.label) ? ' is-on' : ''}`}
              aria-pressed={selected.includes(t.label)}
              onClick={() => toggle(t.label)}
              title={`${t.jobs} jobs give it · you have ${formatPerkValue(t.earned, t.unit)} from careers`}
            >
              {t.label} <span class="ca-chip__n">{t.jobs}</span>
            </button>
          ))}
        </div>
        {selected.length > 0 && (
          <button type="button" class="st-linkbtn" onClick={() => (setSelected([]), lsSet(LS.perks, []))}>
            Clear {selected.length} selected
          </button>
        )}
      </div>

      <div class="db-fields">
        <label class="db-field">
          <input type="checkbox" checked={f.hideEarned} onChange={() => setFilters({ hideEarned: !f.hideEarned })} /> Hide earned
        </label>
        <label class="db-field">
          <input type="checkbox" checked={f.hideLocked} onChange={() => setFilters({ hideLocked: !f.hideLocked })} /> Hide jobs above your level
        </label>
        <label class="db-field">
          Family
          <select class="db-input ca-select" value={f.family} onChange={(e) => setFilters({ family: (e.target as HTMLSelectElement).value })}>
            <option value="all">All</option>
            {families.map((fam) => (
              <option key={fam} value={fam}>{fam}</option>
            ))}
          </select>
        </label>
      </div>

      {goals.enabled && goals.goals.length > 0 && (
        <p class="db-note ca-modenote">Goal mode is on, so it picks Career Auto's job: Run now is off. Add jobs as goals instead, or turn goal mode off on the Goals tab.</p>
      )}
      {selected.length === 0 ? (
        <p class="db-empty">Pick one or more perks above to see every job that gives them.</p>
      ) : shown.length === 0 ? (
        <p class="db-empty">No jobs match. Try showing earned perks or jobs above your level.</p>
      ) : (
        <div class="st-table-wrap">
          <table class="st-table ca-table">
            <thead>
              <tr>
                {head('value', 'Perk')}
                <th scope="col">Job</th>
                {head('level', 'Level')}
                <th scope="col">You're at</th>
                {head('shifts', 'Shifts left')}
                {head('energy', 'Energy left')}
                {head('regen', 'On regen', 'Time on energy regen alone, counting the energy you have now')}
                {head('fastest', 'Fastest', 'If energy is never short (items, refills): the cooldown alone')}
                <th scope="col"><span class="st-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const inGoals = goals.goals.find((g) => g.careerId === r.job.id);
                const key = `${r.job.id}-${r.rank}`;
                return (
                  <tr key={key} class={r.earned ? 'ca-row--earned' : r.locked ? 'ca-row--locked' : ''}>
                    <td class="ca-perkcell">
                      <span class="ca-perkhead">
                        <span class="ca-perk">+{formatPerkValue(r.perk.value, r.perk.unit)}</span> <span class="ca-perk__rank">at R{r.rank}</span>
                      </span>
                      <span class="ca-perk__label">{r.perk.label}</span>
                    </td>
                    <td class="ca-jobcell">
                      <div class="ca-job">{r.job.name}</div>
                      <div class="st-muted ca-sub">
                        {familyShort(r.job.family)}
                        {r.job.energy !== undefined && ` · ${r.job.energy} energy`}
                        {r.job.cooldownMin != null && ` · ${r.job.cooldownMin}m cooldown`}
                      </div>
                      {r.onTheWay.length > 0 && !r.earned && <div class="ca-sub ca-way">On the way: {r.onTheWay.join(' · ')}</div>}
                    </td>
                    <td class="st-num">{r.job.level ?? '—'}</td>
                    <td>
                      {r.earned ? (
                        <span class="st-tag st-tag--up">Earned</span>
                      ) : r.locked ? (
                        <span class="st-tag st-tag--warn">Needs level {r.job.level}</span>
                      ) : (
                        <RankCell job={r.job} />
                      )}
                    </td>
                    <td class="st-num">{r.earned ? '—' : r.est.shifts}</td>
                    <td class="st-num">{r.earned || r.est.energy === null ? '—' : r.est.energy.toLocaleString()}</td>
                    <td class="st-num">{r.earned || r.locked ? '—' : formatHours(r.est.regenHours)}</td>
                    <td class="st-num">{r.earned || r.locked ? '—' : formatHours(r.est.fastestHours)}</td>
                    <td class="ca-actions">
                      {!r.earned && (
                        <>
                          <button
                            type="button"
                            class="db-btn"
                            disabled={!!inGoals && inGoals.targetRank >= r.rank}
                            onClick={() => addGoal(goals, { careerId: r.job.id, careerName: r.job.name, targetRank: r.rank })}
                          >
                            {!inGoals ? 'Add goal' : inGoals.targetRank >= r.rank ? `In goals (R${inGoals.targetRank})` : `Raise goal to R${r.rank}`}
                          </button>
                          {!r.locked &&
                            (auto.careerId === r.job.id ? (
                              <span class="st-muted ca-sub">Career Auto's job</span>
                            ) : confirmRun === r.job.id ? (
                              <span class="ca-confirm">
                                Switch Career Auto to this job?{' '}
                                <button type="button" class="db-btn db-btn--primary" onClick={() => runNow(r)}>Switch</button>{' '}
                                <button type="button" class="db-btn" onClick={() => setConfirmRun(null)}>Cancel</button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                class="db-btn"
                                disabled={goals.enabled && goals.goals.length > 0}
                                title={goals.enabled && goals.goals.length > 0 ? 'Goal mode is choosing the job. Add it as a goal instead, or turn goal mode off.' : undefined}
                                onClick={() => setConfirmRun(r.job.id)}
                              >
                                Run now
                              </button>
                            ))}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p class="db-note">
        Shifts left come from each job's own progress bar: ranks unlock at 1, 10, 35, 85 and 185 total shifts (checked on every shift in your
        archive). "On regen" counts {live ? `your ${live.energy} energy now and +1 every ${live.energyRegenSeconds}s` : 'energy regen'}; jobs
        share one cooldown, so goals run one after another.
      </p>
    </>
  );
}

/** The job's rank and progress. A job with no shifts yet shows "Not
 *  started": its card reads "0 / 10 to Foundation", but R1 (Foundation) comes
 *  with the first shift (see RANK_SHIFTS). */
function RankCell({ job }: { job: PerkRow['job'] }) {
  if (!job.rankName || /unranked/i.test(job.rankName)) return <div>Not started</div>;
  return (
    <>
      <div>{job.rankName}</div>
      {job.next && <div class="st-muted ca-sub">{job.next.done} / {job.next.need} shifts to {job.next.rankName}</div>}
    </>
  );
}

// ── Perk totals ─────────────────────────────────────────────────────────

type TotalsSort = 'label' | 'earned' | 'reachable' | 'all' | 'jobs';

function PerkTotals({ totals }: { totals: PerkTotal[] }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: TotalsSort; desc: boolean }>({ key: 'label', desc: false });

  const shown = totals
    .filter((t) => !search || t.label.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const d = sort.key === 'label' ? a.label.localeCompare(b.label) : (a[sort.key] as number) - (b[sort.key] as number);
      return sort.desc ? -d : d;
    });

  const head = (key: TotalsSort, label: string, num = true) => (
    <th scope="col" class={num ? 'st-num' : undefined} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" class="ca-sort" onClick={() => setSort(sort.key === key ? { key, desc: !sort.desc } : { key, desc: key !== 'label' })}>
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}</span>
      </button>
    </th>
  );

  return (
    <>
      <input
        type="search"
        class="db-input ca-search"
        placeholder="Search perks"
        aria-label="Search perks"
        value={search}
        onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
      />
      <div class="st-table-wrap">
        <table class="st-table ca-table">
          <thead>
            <tr>
              {head('label', 'Perk', false)}
              {head('earned', 'From careers now')}
              {head('reachable', 'At your level')}
              {head('all', 'All jobs')}
              {head('jobs', 'Jobs earned / all')}
              <th scope="col">Cap (all sources)</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const over = t.cap?.cap != null && t.reachable > t.cap.cap;
              return (
                <tr key={t.label}>
                  <td>{t.label}</td>
                  <td class="st-num">{formatPerkValue(t.earned, t.unit)}</td>
                  <td class="st-num">{formatPerkValue(t.reachable, t.unit)}</td>
                  <td class="st-num">{formatPerkValue(t.all, t.unit)}</td>
                  <td class="st-num">{t.jobsEarned} / {t.jobs}</td>
                  <td>
                    {t.cap === undefined ? (
                      <span class="st-muted">No cap listed on the wiki</span>
                    ) : t.cap.cap === null ? (
                      <span class="st-muted">No cap ({t.cap.note})</span>
                    ) : (
                      <>
                        {formatPerkValue(t.cap.cap, t.unit)} <span class="st-muted ca-sub">{t.cap.note}</span>
                        {over && <span class="st-tag st-tag--warn ca-gap">Careers alone could pass it</span>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p class="db-note">
        "From careers now" adds up the perks you've earned; they stack. Caps are on the total from every source (Academy, Bloodline, Family Tree
        too), from the game's wiki (Nov 10). Your Real Estate page shows your full Property and Passive Income totals.
      </p>
    </>
  );
}

// ── Goals ───────────────────────────────────────────────────────────────

function Goals({
  goals, status, auto, snapshot, live,
}: { goals: CareerGoalsConfig; status: CareerGoalsStatus; auto: CareerAutoConfig; snapshot: CareersSnapshot; live: Live | null }) {
  const save = async (change: Partial<CareerGoalsConfig>) => storage.setCareerGoalsConfig({ ...(await storage.getCareerGoalsConfig()), ...change });
  const move = (i: number, d: -1 | 1) => {
    const list = [...goals.goals];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void save({ goals: list });
  };
  const level = live?.level ?? null;
  const states = goals.goals.map((g) => goalState(g, snapshot, level));
  const firstOpen = states.findIndex((s) => s.kind === 'open');
  let totalShifts = 0;
  let totalEnergy = 0;

  return (
    <>
      <label class="db-switch">
        <div>
          <div class="db-switch__title">Goal mode</div>
          <div class="db-switch__hint">
            {goals.enabled
              ? 'On: Career Auto works the first unfinished goal below, normal shifts only, and moves on when its perk is earned.'
              : 'Off: the list is just a plan. Career Auto runs the job you picked, as before.'}
          </div>
        </div>
        <input type="checkbox" class="db-toggle" checked={goals.enabled} onChange={() => void save({ enabled: !goals.enabled })} />
      </label>
      {goals.enabled && !auto.enabled && (
        <p class="db-warn">
          Career Auto is off, so goals won't run. <a href="#/automations/career-auto">Turn on Auto-Run in the Auto-Run tab</a>.
        </p>
      )}

      <p class="db-note ca-modenote">
        Energy items and the free daily refill are Auto-Run settings: they top up whatever job Career Auto runs, goals included.{' '}
        <a href="#/automations/career-auto">Set them in the Auto-Run tab</a>
        {auto.useEnergyItems || auto.useFreeRefill
          ? ` (on: ${[auto.useEnergyItems && 'energy items', auto.useFreeRefill && 'free refill'].filter(Boolean).join(', ')}).`
          : ' (both off).'}
      </p>

      {status.queueFinishedAt !== null && goals.goals.length === 0 && (
        <div class="ff-health-alert" style={{ borderColor: 'var(--ff-gold)' }}>
          <strong>All goals done</strong>
          <span class="ff-health-alert__hint">
            Career Auto keeps running {auto.careerName}. You'll be reminded every 4 hours until you add a goal, pick a job or press Keep running.{' '}
            <button type="button" class="db-btn" onClick={() => chrome.runtime.sendMessage({ type: 'career-goals-keep-running' } satisfies ExtensionMessage)}>
              Keep running this job
            </button>
          </span>
        </div>
      )}

      <h2 class="db-subh">Goals, in order</h2>
      {goals.goals.length === 0 ? (
        <p class="db-empty">No goals. Add some from the Perk finder.</p>
      ) : (
        <div class="st-table-wrap">
          <table class="st-table ca-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Job and target</th>
                <th scope="col">Status</th>
                <th scope="col" class="st-num">Shifts left</th>
                <th scope="col" class="st-num">Energy left</th>
                <th scope="col" class="st-num">On regen</th>
                <th scope="col"><span class="st-sr">Order</span></th>
              </tr>
            </thead>
            <tbody>
              {goals.goals.map((g, i) => {
                const st = states[i];
                const job = snapshot.jobs.find((j) => j.id === g.careerId);
                const est = st.kind === 'open' ? estimate(st.job, g.targetRank, live) : null;
                if (est) {
                  totalShifts += est.shifts;
                  totalEnergy += est.energy ?? 0;
                }
                return (
                  <tr key={`${g.careerId}`}>
                    <td class="st-num">{i + 1}</td>
                    <td class="ca-goaljob">
                      <div class="ca-job">{g.careerName}</div>
                      {job && <div class="st-muted ca-sub">{familyShort(job.family)} · {!job.rankName || /unranked/i.test(job.rankName) ? 'Not started' : job.rankName}</div>}
                      <select
                        class="db-input ca-select ca-goalselect"
                        aria-label={`Target rank for ${g.careerName}`}
                        value={g.targetRank}
                        onChange={(e) => {
                          const targetRank = Number((e.target as HTMLSelectElement).value) as CareerGoal['targetRank'];
                          void save({ goals: goals.goals.map((x, k) => (k === i ? { ...x, targetRank } : x)) });
                        }}
                      >
                        {[1, 2, 3, 4].map((r) => (
                          <option key={r} value={r}>R{r}: {perkTextAt(job, r)}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {st.kind === 'done' ? (
                        <span class="st-tag st-tag--up">Earned</span>
                      ) : st.kind === 'locked' ? (
                        <span class="st-tag st-tag--warn">Waiting for level {st.level}</span>
                      ) : st.kind === 'missing' ? (
                        <span class="st-tag st-tag--warn">Not on the Careers page</span>
                      ) : i === firstOpen && goals.enabled && auto.enabled ? (
                        <span class="st-tag st-tag--info">Working now</span>
                      ) : (
                        <span class="st-tag">Queued</span>
                      )}
                    </td>
                    <td class="st-num">{est ? est.shifts : '—'}</td>
                    <td class="st-num">{est?.energy != null ? est.energy.toLocaleString() : '—'}</td>
                    <td class="st-num">{est ? formatHours(est.regenHours) : '—'}</td>
                    <td class="ca-actions ca-actions--row">
                      <button type="button" class="db-btn" aria-label={`Move ${g.careerName} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button type="button" class="db-btn" aria-label={`Move ${g.careerName} down`} disabled={i === goals.goals.length - 1} onClick={() => move(i, 1)}>↓</button>
                      <button type="button" class="db-btn" aria-label={`Remove ${g.careerName}`} title="Remove goal" onClick={() => void save({ goals: goals.goals.filter((_, k) => k !== i) })}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr class="st-total">
                <td />
                <td colSpan={2}>Goals you can work now</td>
                <td class="st-num">{totalShifts}</td>
                <td class="st-num">{totalEnergy.toLocaleString()}</td>
                <td class="st-num">
                  {live && live.energyRegenSeconds > 0
                    ? formatHours((Math.max(0, totalEnergy - live.energy) * live.energyRegenSeconds) / 3600)
                    : '—'}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {status.completed.length > 0 && (
        <>
          <h2 class="db-subh">Recently earned</h2>
          <ul class="ca-done">
            {status.completed.map((c) => (
              <li key={`${c.careerName}-${c.at}`}>
                {c.perk} <span class="st-muted">· {c.careerName} R{c.targetRank} · {new Date(c.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
