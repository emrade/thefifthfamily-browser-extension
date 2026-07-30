import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import { STORAGE_KEYS } from '@/shared/constants';
import type { PlayerStatsSnapshot } from '@/shared/types';

function formatCash(n: number): string {
  return `$${n.toLocaleString()}`;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function AttributeTile(props: { label: string; value: number; color: string }) {
  return (
    <div class="ff-stat-tile">
      <div class="ff-stat-tile__value" style={{ color: props.color }}>{props.value.toLocaleString()}</div>
      <div class="ff-stat-tile__label">{props.label}</div>
    </div>
  );
}

function ResourceBar(props: { label: string; value: number; max: number; color: string }) {
  const pct = props.max > 0 ? Math.min(100, (props.value / props.max) * 100) : 0;
  return (
    <div>
      <div class="ff-resource__head">
        <span class="ff-resource__label">{props.label}</span>
        <span class="ff-resource__value">{props.value.toLocaleString()} / {props.max.toLocaleString()}</span>
      </div>
      <div class="ff-resource__bar">
        <div class="ff-resource__fill" style={{ width: `${pct}%`, background: props.color }} />
      </div>
    </div>
  );
}

export function LiveStats() {
  const [stats, setStats] = useState<PlayerStatsSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    storage.getLatestStats().then((s) => {
      setStats(s);
      setLoaded(true);
    });

    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'local' || !changes[STORAGE_KEYS.LATEST_STATS]) return;
      setStats(changes[STORAGE_KEYS.LATEST_STATS].newValue ?? null);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  if (!loaded) return null;

  if (!stats) {
    return (
      <div class="ff-empty">
        <strong>No intel yet</strong>
        Open thefifthfamily.com and play a moment — your stats show up here
        automatically once the extension sees them.
      </div>
    );
  }

  return (
    <>
      <div class="ff-location">
        <div>
          <div class="ff-location__label">Current Location</div>
          <div class="ff-location__name">{stats.currentDistrict}</div>
        </div>
        {stats.travelling && (
          <div class="ff-location__travel">
            <span class="ff-location__travel-label">En route → {stats.travelDestination ?? '?'}</span>
            <span class="ff-location__travel-time ff-mono">{formatClock(stats.travelSecondsRemaining)}</span>
          </div>
        )}
      </div>

      <div class="ff-ledger">
        <span class="ff-ledger__label">Cash on Hand</span>
        <span class="ff-ledger__value">{formatCash(stats.cash)}</span>
        <span class="ff-ledger__label">Bank</span>
        <span class="ff-ledger__value">{formatCash(stats.bank)}</span>
      </div>

      <div class="ff-resources">
        <ResourceBar label="Energy" value={stats.energy} max={stats.maxEnergy} color="var(--ff-gold-bright)" />
        <ResourceBar label="Stamina" value={stats.stamina} max={stats.maxStamina} color="var(--ff-green)" />
        <ResourceBar label="Nerve" value={stats.nerve} max={stats.maxNerve} color="var(--ff-purple)" />
        <ResourceBar label="Vitality" value={stats.vitality} max={stats.maxVitality} color="var(--ff-red)" />
      </div>

      <div class="ff-attr-grid">
        <AttributeTile label="Strength" value={stats.strength} color="var(--ff-red)" />
        <AttributeTile label="Defence" value={stats.defence} color="var(--ff-blue)" />
        <AttributeTile label="Agility" value={stats.agility} color="var(--ff-green)" />
        <AttributeTile label="Dexterity" value={stats.dexterity} color="var(--ff-gold-bright)" />
      </div>
    </>
  );
}
