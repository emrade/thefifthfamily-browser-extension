import { useEffect, useState } from 'preact/hooks';
import { LiveStats } from './LiveStats';
import { ReloadGameTabsRow, UpdateBanner } from './GameTabs';
import { HealthAlert } from './HealthAlert';
import { LOG_PREFIX } from '@/shared/log';
import { storage } from '@/shared/storage';
import type { CareerAutoConfig, CourierAutoConfig, CrimesAutoConfig, RealEstateAutoConfig, StreetIntelAutoConfig } from '@/shared/types';
import { ArchiveIcon, BriefcaseIcon, BuildingIcon, ChevronRightIcon, CrosshairIcon, FightClubIcon, GaugeIcon, MaskIcon, SendIcon, SettingsIcon } from './icons';

interface HomeProps {
  onOpenDashboard: () => void;
  onOpenFightClub: () => void;
  onOpenRequestLog: () => void;
  onOpenCareerAuto: () => void;
  onOpenStreetIntelAuto: () => void;
  onOpenPetCouriers: () => void;
  onOpenCrimesAuto: () => void;
  onOpenRealEstateAuto: () => void;
  onOpenSettings: () => void;
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


  return (
    <>
      <UpdateBanner />

      <LiveStats />

      <HealthAlert />

      <div class="ff-section-label">Features</div>

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

      <button class="ff-nav-row" onClick={props.onOpenDashboard}>
        <div class="ff-nav-row__icon"><GaugeIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Dashboard</div>
          <div class="ff-nav-row__status">Everything, including settings, in its own tab</div>
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

      <button class="ff-nav-row" onClick={props.onOpenPetCouriers}>
        <div class="ff-nav-row__icon"><SendIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Pet Couriers</div>
          <div class="ff-nav-row__status">{courierAutoStatus}</div>
        </div>
        <div class="ff-nav-row__chevron"><ChevronRightIcon /></div>
      </button>

      <button class="ff-nav-row" onClick={props.onOpenCrimesAuto}>
        <div class="ff-nav-row__icon"><MaskIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Crimes Auto</div>
          <div class="ff-nav-row__status">{crimesAutoStatus}</div>
        </div>
        <div class="ff-nav-row__chevron"><ChevronRightIcon /></div>
      </button>

      <button class="ff-nav-row" onClick={props.onOpenRealEstateAuto}>
        <div class="ff-nav-row__icon"><BuildingIcon /></div>
        <div class="ff-nav-row__text">
          <div class="ff-nav-row__title">Real Estate Auto-Collect</div>
          <div class="ff-nav-row__status">{realEstateAutoStatus}</div>
        </div>
        <div class="ff-nav-row__chevron"><ChevronRightIcon /></div>
      </button>

      <ReloadGameTabsRow />

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
