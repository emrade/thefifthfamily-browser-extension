import '../design/tokens.css';
import './app.css';
import { Home } from './views/Home';
import type { DashboardSection } from '@/shared/dashboardSections';
import type { ExtensionMessage } from '@/shared/messaging';
import { LOG_PREFIX } from '@/shared/log';
import manifest from '../../manifest.json';

/**
 * The popup is a launcher: live stats, health alerts and each feature's
 * status at a glance. Every row opens that section of the Dashboard (a full
 * page in its own tab), where all the screens and settings now live — the
 * popup closes on a stray click, so nothing is edited here any more.
 */
function open(section: DashboardSection): () => void {
  return () => {
    const msg: ExtensionMessage = { type: 'dashboard-open-requested', section };
    chrome.runtime
      .sendMessage(msg)
      .then(() => window.close())
      .catch((err) => console.error(LOG_PREFIX, 'open Dashboard failed', err));
  };
}

export function App() {
  return (
    <div class="popup-root">
      <header class="ff-header">
        <div class="ff-crest"><span>V</span></div>
        <div class="ff-header__text">
          <span class="ff-header__title">The Fifth Family</span>
          <span class="ff-header__subtitle">Enhancements</span>
        </div>
      </header>

      <div class="ff-divider" />

      <main class="ff-main">
        <Home
          onOpenDashboard={open('overview')}
          onOpenFightClub={open('fight-club')}
          onOpenRequestLog={open('http-archive')}
          onOpenCareerAuto={open('automations/career-auto')}
          onOpenStreetIntelAuto={open('automations/street-intel')}
          onOpenPetCouriers={open('automations/pet-couriers')}
          onOpenCrimesAuto={open('automations/crimes-auto')}
          onOpenRealEstateAuto={open('automations/real-estate-auto')}
          onOpenSettings={open('settings')}
        />
      </main>

      <footer class="ff-footer">
        <span>v{manifest.version}</span>
        <a href="https://www.thefifthfamily.com" target="_blank" rel="noreferrer">
          thefifthfamily.com ↗
        </a>
      </footer>
    </div>
  );
}
