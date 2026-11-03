import { useEffect, useState } from 'preact/hooks';
import { LiveStats } from './LiveStats';
import { ReloadGameTabsRow, UpdateBanner } from './GameTabs';
import { HealthAlert } from './HealthAlert';
import { ExportDueBanner } from './ExportDueBanner';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { CareerAutoConfig, CourierAutoConfig, CrimesAutoConfig, RealEstateAutoConfig, StreetIntelAutoConfig } from '@/shared/types';
import { ChevronRightIcon, GaugeIcon } from './icons';

interface HomeProps {
  onOpenDashboard: () => void;
  /** Opens the Dashboard's HTTP Archive section (the export reminder's button). */
  onOpenRequestLog: () => void;
  onOpenCareerAuto: () => void;
  onOpenStreetIntelAuto: () => void;
  onOpenPetCouriers: () => void;
  onOpenCrimesAuto: () => void;
  onOpenRealEstateAuto: () => void;
}

export function Home(props: HomeProps) {
  const [careerAutoConfig, setCareerAutoConfig] = useState<CareerAutoConfig | null>(null);
  const [streetIntelAutoConfig, setStreetIntelAutoConfig] = useState<StreetIntelAutoConfig | null>(null);
  const [courierAutoConfig, setCourierAutoConfig] = useState<CourierAutoConfig | null>(null);
  const [crimesAutoConfig, setCrimesAutoConfig] = useState<CrimesAutoConfig | null>(null);
  const [realEstateAutoConfig, setRealEstateAutoConfig] = useState<RealEstateAutoConfig | null>(null);
  // The icon badge's own count, read back rather than re-derived — the badge
  // already *is* "how many pets need attention right now," so this row just
  // surfaces the same number instead of running its own separate computation
  // that could disagree with it.
  const [courierBadge, setCourierBadge] = useState('');

  useEffect(() => {
    storage
      .getCareerAutoConfig()
      .then(setCareerAutoConfig)
      .catch((err) => console.error(LOG_PREFIX, 'failed to read career auto config', err));
    storage
      .getStreetIntelAutoConfig()
      .then(setStreetIntelAutoConfig)
      .catch((err) => console.error(LOG_PREFIX, 'failed to read street intel auto config', err));
    storage
      .getCourierAutoConfig()
      .then(setCourierAutoConfig)
      .catch((err) => console.error(LOG_PREFIX, 'failed to read courier auto config', err));
    storage
      .getCrimesAutoConfig()
      .then(setCrimesAutoConfig)
      .catch((err) => console.error(LOG_PREFIX, 'failed to read crimes auto config', err));
    storage
      .getRealEstateAutoConfig()
      .then(setRealEstateAutoConfig)
      .catch((err) => console.error(LOG_PREFIX, 'failed to read real estate auto config', err));
    chrome.action
      .getBadgeText({})
      .then(setCourierBadge)
      .catch((err) => console.error(LOG_PREFIX, 'failed to read courier badge text', err));
  }, []);

  const careerAutoStatus = !careerAutoConfig || careerAutoConfig.careerId == null
    ? 'Not set up'
    : careerAutoConfig.enabled
      ? `Running ${careerAutoConfig.careerName}`
      : 'Off';

  const streetIntelAutoStatus = streetIntelAutoConfig?.enabled ? 'Running' : 'Off';

  // `watchEnabled` off means nothing at all is happening in the background —
  // that takes priority over the badge and action toggles below, both of
  // which can only be stale leftovers from before it was turned off (the
  // badge isn't cleared on toggle-off, and courierWatch.ts forces both action
  // toggles off in the same write anyway). With watch on, either action
  // toggle being on still reads as "Auto-watch on" (unchanged); watch on with
  // both actions off is a real, deliberate state now — "just detect and
  // notify, don't act" — so it gets its own label instead of collapsing into
  // the same "Off" a fully-disabled watch shows.
  const courierAutoStatus = !courierAutoConfig?.watchEnabled
    ? 'Off'
    : courierBadge
      ? `${courierBadge} pet${courierBadge === '1' ? '' : 's'} ready to send`
      : courierAutoConfig.autoDispatchEnabled || courierAutoConfig.autoOffloadEnabled
        ? 'Auto-watch on'
        : 'Watching';

  const crimesAutoStatus = crimesAutoConfig?.enabled ? 'Running' : 'Off';

  const realEstateAutoStatus = realEstateAutoConfig?.enabled ? `Collects after ${realEstateAutoConfig.intervalHours}h without one` : 'Off';


  // Compact, glanceable statuses; each opens that automation's Dashboard section.
  const statuses = [
    { label: 'Career Auto', value: careerAutoStatus, open: props.onOpenCareerAuto },
    { label: 'Street Intel Auto', value: streetIntelAutoStatus, open: props.onOpenStreetIntelAuto },
    { label: 'Pet Couriers', value: courierAutoStatus, open: props.onOpenPetCouriers },
    { label: 'Crimes Auto', value: crimesAutoStatus, open: props.onOpenCrimesAuto },
    { label: 'Real Estate Auto-Collect', value: realEstateAutoStatus, open: props.onOpenRealEstateAuto },
  ];

  return (
    <>
      <UpdateBanner />
      <ExportDueBanner onOpen={props.onOpenRequestLog} />

      <LiveStats />

      <HealthAlert />

      <button class="ff-dash-btn" onClick={props.onOpenDashboard}>
        <GaugeIcon />
        <span>Open Dashboard</span>
        <ChevronRightIcon />
      </button>

      <div class="ff-section-label">Automations</div>

      <div class="ff-status-list">
        {statuses.map((s) => (
          <button class="ff-status-row" key={s.label} onClick={s.open} title={`Open ${s.label} on the Dashboard`}>
            <span class="ff-status-row__name">{s.label}</span>
            <span class={`ff-status-row__value${s.value === 'Off' || s.value === 'Not set up' ? ' is-off' : ''}`}>{s.value}</span>
          </button>
        ))}
      </div>

      <ReloadGameTabsRow />
    </>
  );
}
