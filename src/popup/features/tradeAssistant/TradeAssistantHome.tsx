import { useState } from 'preact/hooks';
import { Overview } from './tabs/Overview';
import { Market } from './tabs/Market';
import { Calculator } from './tabs/Calculator';
import { Analytics } from './tabs/Analytics';
import { RiskDatabase } from './tabs/RiskDatabase';

type Tab = 'overview' | 'market' | 'calculator' | 'analytics' | 'riskdb';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'market', label: 'Market' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'riskdb', label: 'Risk DB' },
];

export function TradeAssistantHome() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div>
      <div class="ff-tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            class={`ff-tab${tab === t.id ? ' ff-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'market' && <Market />}
      {tab === 'calculator' && <Calculator />}
      {tab === 'analytics' && <Analytics />}
      {tab === 'riskdb' && <RiskDatabase />}
    </div>
  );
}
