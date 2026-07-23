import { LiveStats } from './LiveStats';

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
        <div class="ff-nav-row__icon">$</div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Trade Assistant</div>
          <div class="ff-nav-row__status">Recording trades in the background</div>
        </div>
        <div class="ff-nav-row__chevron">›</div>
      </button>

      <button class="ff-nav-row" onClick={props.onOpenSettings}>
        <div class="ff-nav-row__icon">⚙</div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Settings</div>
          <div class="ff-nav-row__status">Backup or clear stored data</div>
        </div>
        <div class="ff-nav-row__chevron">›</div>
      </button>
    </>
  );
}
