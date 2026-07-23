import { LiveStats } from './LiveStats';
import { CashIcon, ChevronRightIcon, SettingsIcon } from './icons';

interface HomeProps {
  onOpenTradeAssistant: () => void;
  onOpenSettings: () => void;
}

export function Home(props: HomeProps) {
  return (
    <>
      <LiveStats />

      <div class="ff-section-label">Features</div>

      <button class="ff-nav-row" onClick={props.onOpenTradeAssistant}>
        <div class="ff-nav-row__icon"><CashIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Trade Assistant</div>
          <div class="ff-nav-row__status">Recording trades in the background</div>
        </div>
        <div class="ff-nav-row__chevron"><ChevronRightIcon /></div>
      </button>

      <button class="ff-nav-row" onClick={props.onOpenSettings}>
        <div class="ff-nav-row__icon"><SettingsIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Settings</div>
          <div class="ff-nav-row__status">Backup or clear stored data</div>
        </div>
        <div class="ff-nav-row__chevron"><ChevronRightIcon /></div>
      </button>
    </>
  );
}
