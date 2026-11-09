import { render, type ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../design/tokens.css';
import '../popup/app.css';
import './dashboard.css';
import type { ExtensionMessage } from '@/shared/messaging';
import { isDashboardSection, type DashboardSection } from '@/shared/dashboardSections';
import { AutomationsSection } from './sections/Automations';
import { ArenaSection } from './sections/Arena';
import { CombatStatsSection } from './sections/CombatStats';
import { LiveStats } from '../popup/views/LiveStats';
import { HealthAlert } from '../popup/views/HealthAlert';
import { ExportDueBanner } from '../popup/views/ExportDueBanner';
import { ReloadGameTabsRow, UpdateBanner } from '../popup/views/GameTabs';
import { Settings } from '../popup/views/Settings';
import { FightClubHome } from '../popup/features/fightClub/FightClubHome';
import { RequestLogHome } from '../popup/features/requestLog/RequestLogHome';
import { CareerAutoHome } from '../popup/features/careerAuto/CareerAutoHome';
import { StreetIntelAutoHome } from '../popup/features/streetIntelAuto/StreetIntelAutoHome';
import { PetCouriersHome } from '../popup/features/petCouriers/PetCouriersHome';
import { CrimesAutoHome } from '../popup/features/crimesAuto/CrimesAutoHome';
import { RealEstateAutoHome } from '../popup/features/realEstateAuto/RealEstateAutoHome';
import manifest from '../../manifest.json';

/**
 * The Dashboard: the extension's full page, in its own tab (the popup closes
 * too easily, and Firefox's sidebar shrank the game). Every feature screen and
 * all settings live here; the popup is a launcher into it. Each section has
 * its own address (`#/settings`, `#/automations/street-intel`, …) so a reload
 * keeps the place and the popup / "Up next" chip can open straight to one.
 *
 * The feature screens are the popup's own components, unchanged — same names,
 * wording and behaviour, just with more room.
 */

interface MenuItem {
  id: DashboardSection;
  label: string;
  sub?: boolean;
}

const MENU: MenuItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'automations', label: 'Automations' },
  { id: 'automations/street-intel', label: 'Street Intel Auto', sub: true },
  { id: 'automations/pet-couriers', label: 'Pet Couriers', sub: true },
  { id: 'automations/career-auto', label: 'Career Auto', sub: true },
  { id: 'automations/crimes-auto', label: 'Crimes Auto', sub: true },
  { id: 'automations/real-estate-auto', label: 'Real Estate Auto-Collect', sub: true },
  { id: 'combat-stats', label: 'Combat Stats' },
  { id: 'arena', label: 'Arena' },
  { id: 'fight-club', label: 'Fight Club' },
  { id: 'http-archive', label: 'HTTP Archive' },
  { id: 'settings', label: 'Settings' },
];

function sectionFromHash(): DashboardSection {
  // "#/combat-stats?pet-planner": the part after "?" is for the section itself.
  const s = location.hash.replace(/^#\/?/, '').split('?')[0];
  return isDashboardSection(s) ? s : 'overview';
}

function useSection(): DashboardSection {
  const [section, setSection] = useState<DashboardSection>(sectionFromHash());
  useEffect(() => {
    const onHash = () => {
      setSection(sectionFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return section;
}

/** The popup's screens were drawn for its 380px width: keep forms to a
 *  readable column instead of stretching them across the page. */
function Narrow({ children }: { children: ComponentChildren }) {
  return <div class="db-narrow">{children}</div>;
}

function Content({ section }: { section: DashboardSection }) {
  switch (section) {
    case 'overview':
      return (
        <Narrow>
          <UpdateBanner />
          <ExportDueBanner onOpen={() => (location.hash = '#/http-archive')} />
          <LiveStats />
          <HealthAlert />
          <ReloadGameTabsRow />
        </Narrow>
      );
    case 'automations':
      return <AutomationsSection />;
    case 'automations/street-intel':
      return <Narrow><StreetIntelAutoHome /></Narrow>;
    case 'automations/pet-couriers':
      return <Narrow><PetCouriersHome /></Narrow>;
    case 'automations/career-auto':
      return <Narrow><CareerAutoHome /></Narrow>;
    case 'automations/crimes-auto':
      return <Narrow><CrimesAutoHome /></Narrow>;
    case 'automations/real-estate-auto':
      return <Narrow><RealEstateAutoHome /></Narrow>;
    case 'combat-stats':
      return <CombatStatsSection />;
    case 'arena':
      return <ArenaSection />;
    case 'fight-club':
      return <Narrow><FightClubHome /></Narrow>;
    case 'http-archive':
      return (
        <Narrow>
          <ExportDueBanner />
          <RequestLogHome />
        </Narrow>
      );
    case 'settings':
      return <Narrow><Settings /></Narrow>;
  }
}

function Dashboard() {
  const section = useSection();
  const current = MENU.find((m) => m.id === section)!;

  useEffect(() => {
    document.title = `${current.label} · Dashboard · The Fifth Family Enhancements`;
  }, [current]);

  return (
    <div class="db-shell">
      <nav class="db-nav" aria-label="Dashboard sections">
        <div class="db-brand">
          <div class="db-eyebrow">The Fifth Family Enhancements</div>
          <div class="db-brand__title">Dashboard</div>
        </div>
        <ul class="db-menu">
          {MENU.map((m) => (
            <li key={m.id}>
              <a
                href={`#/${m.id}`}
                class={`db-menu__link${m.sub ? ' db-menu__link--sub' : ''}${m.id === section ? ' is-active' : ''}`}
                aria-current={m.id === section ? 'page' : undefined}
              >
                {m.label}
              </a>
            </li>
          ))}
        </ul>
        <div class="db-version">v{manifest.version}</div>
      </nav>

      <main class="db-main">
        <h1 class="db-title">{current.label}</h1>
        <Content section={section} />
      </main>
    </div>
  );
}

// Answers the background's "is a Dashboard open?" so opening it again
// switches to this tab instead of opening another (see openDashboard).
chrome.runtime.onMessage.addListener((msg: ExtensionMessage) => {
  if (msg?.type !== 'dashboard-ping') return false;
  return chrome.tabs.getCurrent().then((tab) => (tab?.id !== undefined ? { tabId: tab.id, windowId: tab.windowId } : undefined));
});

render(<Dashboard />, document.getElementById('app')!);
