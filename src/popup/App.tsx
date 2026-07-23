import { useState } from 'preact/hooks';
import '../design/tokens.css';
import './app.css';
import { Home } from './views/Home';
import { Settings } from './views/Settings';
import { ChevronLeftIcon } from './views/icons';
import { TradeAssistantHome } from './features/tradeAssistant/TradeAssistantHome';
import manifest from '../../manifest.json';

type View = 'home' | 'tradeAssistant' | 'settings';

export function App() {
  const [view, setView] = useState<View>('home');

  return (
    <div class="popup-root">
      <header class="ff-header">
        <div class="ff-crest"><span>V</span></div>
        <div class="ff-header__text">
          <span class="ff-header__title">The Fifth Family</span>
          <span class="ff-header__subtitle">Enhancements</span>
        </div>
        {view !== 'home' && (
          <button class="ff-header__back" onClick={() => setView('home')}>
            <ChevronLeftIcon />
            Back
          </button>
        )}
      </header>

      <div class="ff-divider" />

      <main class="ff-main">
        {view === 'home' && (
          <Home onOpenTradeAssistant={() => setView('tradeAssistant')} onOpenSettings={() => setView('settings')} />
        )}
        {view === 'tradeAssistant' && <TradeAssistantHome />}
        {view === 'settings' && <Settings />}
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
