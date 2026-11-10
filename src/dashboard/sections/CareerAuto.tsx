import { useEffect, useState } from 'preact/hooks';
import { CareerAutoHome } from '../../popup/features/careerAuto/CareerAutoHome';
import { CareerAdvisorSection } from './CareerAdvisor';

/**
 * Dashboard → Career Auto: the Auto-Run screen (the popup's own, in its
 * reading-width column) and the Advisor (perk finder, totals, goals; full
 * width) as two tabs of the one feature. Each tab has its own address,
 * `#/automations/career-auto` and `…?advisor`, so a reload keeps it; the
 * popup and in-page links open Auto-Run.
 */

type Tab = 'auto' | 'advisor';

const TABS: { id: Tab; label: string }[] = [
  { id: 'auto', label: 'Auto-Run' },
  { id: 'advisor', label: 'Advisor' },
];

function tabFromHash(): Tab {
  return location.hash.split('?')[1] === 'advisor' ? 'advisor' : 'auto';
}

export function CareerAutoSection() {
  const [tab, setTab] = useState<Tab>(tabFromHash());
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const pick = (t: Tab) => {
    location.hash = t === 'advisor' ? '#/automations/career-auto?advisor' : '#/automations/career-auto';
  };

  return (
    <>
      <div class="db-settings__tabs ca-pagetabs" role="tablist" aria-label="Career Auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`ca-page-tab-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls="ca-page-panel"
            class={`db-settings__tab${t.id === tab ? ' db-settings__tab--active' : ''}`}
            onClick={() => pick(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="ca-page-panel" role="tabpanel" aria-labelledby={`ca-page-tab-${tab}`}>
        {tab === 'advisor' ? (
          <CareerAdvisorSection />
        ) : (
          <div class="db-narrow">
            <CareerAutoHome />
          </div>
        )}
      </div>
    </>
  );
}
