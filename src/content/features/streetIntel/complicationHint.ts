import { injectStyleOnce } from '@/content/shared/injectStyle';
import { LOG_PREFIX } from '@/shared/log';
import { STORAGE_KEYS } from '@/shared/constants';
import { storage } from '@/shared/storage';
import { describeComplicationChoices, isKnownScenario, normalizeScenario } from '@/shared/streetIntelComplications';
import type { ComplicationChoiceKey, ComplicationTypeStats } from '@/shared/types';

/**
 * When a complication comes up during manual play, marks the game's own
 * choice buttons in place: "FF AVOID" on a choice that has never won in this
 * scenario, "FF PICK" on the best remaining one, and every choice's real
 * record — plus a one-line summary under the scenario text. Same data and
 * rule as the auto-runner's `complicationMode: 'avoidBlocked'` (see
 * `@/shared/streetIntelComplications`), so the hint and the automation never
 * disagree.
 *
 * Only adds classes and badges to the game's existing nodes — every choice
 * stays exactly as clickable as the game shipped it, same rule as
 * pageHighlights.ts.
 *
 * DOM: built against the game's own stylesheet (shipped in the
 * `panel.php?type=street_intel` response) — `.si-comp` > `.comp-desc` and
 * `.si-comp-choices` > `.si-comp-choice` (`.ch-name`, `.ch-stat`). The rendered
 * markup itself isn't in any archive (it's drawn client-side), so the choice
 * key is read defensively: from the button's own attributes first (an
 * `onclick`/`data-*` naming fight/run/talk), then from its stat label
 * (Strength→fight, Agility→run, Dexterity→talk), then its name text.
 * **Not yet confirmed against a live complication** — worth a look the next
 * time one comes up.
 */

const STYLE_ID = 'ff-si-comp-hint-style';
const COMP_SELECTOR = '.si-comp';
const CHOICE_SELECTOR = '.si-comp-choice';
/** How long an `attempt` response's scenario stays the trusted source for a
 *  newly opened complication dialog. */
const PENDING_TTL_MS = 10 * 60_000;

const STAT_TO_CHOICE: Record<string, ComplicationChoiceKey> = { strength: 'fight', agility: 'run', dexterity: 'talk' };

const STYLE = `
.si-comp-choice.ff-si-comp-avoid {
  position: relative;
  border-color: rgba(239,68,68,.55) !important;
  background: rgba(239,68,68,.06) !important;
  opacity: .75;
}
.si-comp-choice.ff-si-comp-pick {
  position: relative;
  border-color: rgba(52,211,153,.6) !important;
  background: rgba(52,211,153,.07) !important;
}
.ff-si-comp-badge {
  margin-left: 10px;
  flex-shrink: 0;
  font-size: 0.55rem;
  font-weight: 900;
  letter-spacing: .5px;
  padding: 3px 7px;
  border-radius: 4px;
  white-space: nowrap;
  color: #9ca3af;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.04);
}
.si-comp-choice.ff-si-comp-avoid .ff-si-comp-badge { color: #fca5a5; border-color: rgba(239,68,68,.45); background: rgba(239,68,68,.12); }
.si-comp-choice.ff-si-comp-pick .ff-si-comp-badge { color: #052e1c; border-color: transparent; background: linear-gradient(135deg, #6ee7b7, #34d399); }
.ff-si-comp-summary {
  margin: -6px 0 14px;
  padding: 7px 10px;
  border-radius: 7px;
  font-size: 0.72rem;
  line-height: 1.45;
  color: #d1d5db;
  background: rgba(201,168,76,.07);
  border: 1px solid rgba(201,168,76,.28);
  text-align: left;
}
.ff-si-comp-summary b { color: #f1ede2; }
`;

let pendingScenario: { text: string; at: number } | null = null;
let typeStats: ComplicationTypeStats | undefined;

/** Fed every `POST /actions/street_intel.php` from index.ts — keeps the
 *  scenario of the latest attempt that came back with a complication, so the
 *  dialog that follows can be matched to it exactly. */
export function recordAttemptResponse(requestBody: string, responseText: string): void {
  const action = new URLSearchParams(requestBody).get('action');
  if (action === 'complication') {
    pendingScenario = null; // answered — the next dialog belongs to a new attempt
    return;
  }
  if (action !== 'attempt') return;
  try {
    const json = JSON.parse(responseText);
    const type = json?.ok && json.has_complication ? json.complication?.type : null;
    if (typeof type === 'string' && type) pendingScenario = { text: type, at: Date.now() };
  } catch {
    // Not JSON — nothing to record.
  }
}

function choiceKeyOf(el: Element): ComplicationChoiceKey | null {
  for (const attr of Array.from(el.attributes)) {
    const m = attr.value.match(/\b(fight|run|talk)\b/);
    if (m && (attr.name === 'onclick' || attr.name.startsWith('data-'))) return m[1] as ComplicationChoiceKey;
  }
  const stat = (el.querySelector('.ch-stat')?.textContent ?? '').toLowerCase();
  for (const [name, key] of Object.entries(STAT_TO_CHOICE)) if (stat.includes(name)) return key;
  const name = (el.querySelector('.ch-name')?.textContent ?? '').toLowerCase();
  const m = name.match(/\b(fight|run|talk)\b/);
  return m ? (m[1] as ComplicationChoiceKey) : null;
}

/** The scenario this dialog is for: the latest attempt's own
 *  `complication.type` while it's fresh, else the dialog's description text
 *  if it reads as a known scenario. */
function scenarioFor(comp: Element): string | null {
  if (pendingScenario && Date.now() - pendingScenario.at < PENDING_TTL_MS) return pendingScenario.text;
  const desc = normalizeScenario(comp.querySelector('.comp-desc')?.textContent ?? '');
  return desc && isKnownScenario(desc, typeStats) ? desc : null;
}

function record(wins: number, attempts: number): string {
  return attempts > 0 ? `${wins}/${attempts}` : 'no data';
}

function annotate(comp: Element): void {
  const scenario = scenarioFor(comp);
  if (!scenario) return;
  const choiceEls = Array.from(comp.querySelectorAll(CHOICE_SELECTOR));
  if (choiceEls.length === 0) return;

  // Re-annotating the same dialog with the same data is a no-op; the key
  // changes when the scenario or the live tally does.
  const { choices, best } = describeComplicationChoices(scenario, typeStats);
  const stamp = `${normalizeScenario(scenario)}|${choices.map((c) => `${c.wins}/${c.attempts}`).join(',')}`;
  if ((comp as HTMLElement).dataset.ffCompHint === stamp) return;
  (comp as HTMLElement).dataset.ffCompHint = stamp;

  for (const el of choiceEls) {
    el.classList.remove('ff-si-comp-avoid', 'ff-si-comp-pick');
    el.querySelector('.ff-si-comp-badge')?.remove();
    const key = choiceKeyOf(el);
    const info = key ? choices.find((c) => c.choice === key) : undefined;
    if (!info) continue;

    const badge = document.createElement('span');
    badge.className = 'ff-si-comp-badge';
    if (info.blocked) {
      el.classList.add('ff-si-comp-avoid');
      badge.textContent = `FF AVOID · ${record(info.wins, info.attempts)}`;
    } else if (info.choice === best) {
      el.classList.add('ff-si-comp-pick');
      badge.textContent = `FF PICK · ${record(info.wins, info.attempts)}`;
    } else {
      badge.textContent = record(info.wins, info.attempts);
    }
    badge.title = `${info.choice}: won ${info.wins} of ${info.attempts} times in this scenario (your history).`;
    el.appendChild(badge);
  }

  let summary = comp.querySelector('.ff-si-comp-summary');
  if (!summary) {
    summary = document.createElement('div');
    summary.className = 'ff-si-comp-summary';
    const desc = comp.querySelector('.comp-desc');
    if (desc) desc.after(summary);
    else comp.querySelector('.si-comp-choices')?.before(summary);
  }
  const blocked = choices.filter((c) => c.blocked);
  const bestInfo = choices.find((c) => c.choice === best);
  const bestText = bestInfo ? `Best: <b>${bestInfo.choice}</b> (${record(bestInfo.wins, bestInfo.attempts)}).` : '';
  summary.innerHTML = blocked.length
    ? `FF: Avoid ${blocked.map((c) => `<b>${c.choice}</b> (${record(c.wins, c.attempts)})`).join(', ')} — never won in this scenario. ${bestText}`
    : `FF: No losing choice known for this scenario — the others win about 85% of the time. ${bestText}`;
}

function refresh(): void {
  const comp = document.querySelector(COMP_SELECTOR);
  if (comp) annotate(comp);
}

const INSTALL_FLAG = '__ffStreetIntelComplicationHintInstalled';

export function initStreetIntelComplicationHint(): void {
  if ((window as unknown as Record<string, boolean>)[INSTALL_FLAG]) return;
  (window as unknown as Record<string, boolean>)[INSTALL_FLAG] = true;

  injectStyleOnce(STYLE_ID, STYLE);

  storage
    .getStreetIntelAutoStatus()
    .then((status) => {
      typeStats = status?.complicationTypeStats;
      refresh();
    })
    .catch((err) => console.error(LOG_PREFIX, 'street intel complication hint: status read failed', err));

  // The runner's live tally keeps growing — pick it up without a reload.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEYS.STREET_INTEL_AUTO_STATUS in changes)) return;
    typeStats = changes[STORAGE_KEYS.STREET_INTEL_AUTO_STATUS].newValue?.complicationTypeStats;
    refresh();
  });

  const observer = new MutationObserver(() => refresh());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
