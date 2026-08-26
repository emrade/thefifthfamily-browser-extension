import { useEffect, useState } from 'preact/hooks';
import { LiveStats } from './LiveStats';
import { FEATURE_LABELS, isBroken, readFeatureHealth, type FeatureHealthMap } from '@/shared/featureHealth';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { CareerAutoConfig, StreetIntelAutoConfig } from '@/shared/types';
import { ArchiveIcon, BriefcaseIcon, CashIcon, ChevronRightIcon, CrosshairIcon, FightClubIcon, SettingsIcon } from './icons';

interface HomeProps {
  onOpenTradeAssistant: () => void;
  onOpenFightClub: () => void;
  onOpenRequestLog: () => void;
  onOpenCareerAuto: () => void;
  onOpenStreetIntelAuto: () => void;
  onOpenSettings: () => void;
}

function since(ms: number | null): string {
  if (ms == null) return 'never';
  const mins = Math.round((Date.now() - ms) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function Home(props: HomeProps) {
  const [health, setHealth] = useState<FeatureHealthMap>({});
  const [careerAutoConfig, setCareerAutoConfig] = useState<CareerAutoConfig | null>(null);
  const [streetIntelAutoConfig, setStreetIntelAutoConfig] = useState<StreetIntelAutoConfig | null>(null);

  useEffect(() => {
    readFeatureHealth()
      .then(setHealth)
      .catch((err) => console.error(LOG_PREFIX, 'failed to read feature health', err));
    storage
      .getCareerAutoConfig()
      .then(setCareerAutoConfig)
      .catch((err) => console.error(LOG_PREFIX, 'failed to read career auto config', err));
    storage
      .getStreetIntelAutoConfig()
      .then(setStreetIntelAutoConfig)
      .catch((err) => console.error(LOG_PREFIX, 'failed to read street intel auto config', err));
  }, []);

  const careerAutoStatus = !careerAutoConfig || careerAutoConfig.careerId == null
    ? 'Not set up'
    : careerAutoConfig.enabled
      ? `Running ${careerAutoConfig.careerName}`
      : 'Off';

  const streetIntelAutoStatus = streetIntelAutoConfig?.enabled ? 'Running' : 'Off';

  // Only broken features are listed. A healthy extension shows nothing here — this
  // is meant to be invisible until the day the game changes underneath it, which
  // is the only day it matters.
  const broken = Object.entries(health).filter(([, h]) => isBroken(h));

  return (
    <>
      <LiveStats />

      {broken.length > 0 && (
        <div class="ff-health-alert">
          <strong>{broken.length === 1 ? 'A feature has stopped working' : `${broken.length} features have stopped working`}</strong>
          {broken.map(([id, h]) => (
            <div class="ff-health-alert__row" key={id}>
              <span class="ff-health-alert__name">{FEATURE_LABELS[id] ?? id}</span>
              <span class="ff-health-alert__detail">
                {h.consecutiveFailures} failed parses · last worked {since(h.lastSuccess)}
              </span>
            </div>
          ))}
          <span class="ff-health-alert__hint">
            The game's responses no longer match what this extension expects. The HTTP Archive holds the new
            responses — export a selection for the affected endpoint to see what changed.
          </span>
        </div>
      )}

      <div class="ff-section-label">Features</div>

      <button class="ff-nav-row" onClick={props.onOpenTradeAssistant}>
        <div class="ff-nav-row__icon"><CashIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Trade Assistant</div>
          <div class="ff-nav-row__status">Recording trades in the background</div>
        </div>
        <div class="ff-nav-row__chevron"><ChevronRightIcon /></div>
      </button>

      <button class="ff-nav-row" onClick={props.onOpenFightClub}>
        <div class="ff-nav-row__icon"><FightClubIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Fight Club</div>
          <div class="ff-nav-row__status">Your rating, hits, and record</div>
        </div>
        <div class="ff-nav-row__chevron"><ChevronRightIcon /></div>
      </button>

      <button class="ff-nav-row" onClick={props.onOpenRequestLog}>
        <div class="ff-nav-row__icon"><ArchiveIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">HTTP Archive</div>
          <div class="ff-nav-row__status">Raw request capture and exports</div>
        </div>
        <div class="ff-nav-row__chevron"><ChevronRightIcon /></div>
      </button>

      <button class="ff-nav-row" onClick={props.onOpenCareerAuto}>
        <div class="ff-nav-row__icon"><BriefcaseIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Career Auto</div>
          <div class="ff-nav-row__status">{careerAutoStatus}</div>
        </div>
        <div class="ff-nav-row__chevron"><ChevronRightIcon /></div>
      </button>

      <button class="ff-nav-row" onClick={props.onOpenStreetIntelAuto}>
        <div class="ff-nav-row__icon"><CrosshairIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Street Intel Auto</div>
          <div class="ff-nav-row__status">{streetIntelAutoStatus}</div>
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
