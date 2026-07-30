import { useEffect, useState } from 'preact/hooks';
import { storage } from '@/shared/storage';
import type { FightClubHeroStats } from '@/shared/types';

function formatRelative(ts: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function FightClubHome() {
  const [stats, setStats] = useState<(FightClubHeroStats & { timestamp: number }) | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    storage.getFightClubStats().then((s) => {
      setStats(s);
      setLoaded(true);
    });
  }, []);

  if (!loaded) return null;

  if (!stats) {
    return (
      <div class="ff-empty">
        <strong>No intel yet</strong>
        Open Fight Club in-game — your rating and record show up here automatically.
        Sorting the target list itself now happens directly on that page, next to
        the game's own Filters button.
      </div>
    );
  }

  const tiles = [
    { label: 'Rating', value: String(stats.rating), color: 'var(--ff-purple)' },
    { label: 'Hits Landed', value: String(stats.hitsLanded), color: 'var(--ff-green)' },
    { label: 'Hits Failed', value: String(stats.hitsFailed), color: 'var(--ff-red)' },
    { label: 'Lethality', value: `${stats.lethalityPct}%`, color: 'var(--ff-ink)' },
    { label: 'Hall of Fame', value: stats.hallOfFameRank !== null ? `#${stats.hallOfFameRank}` : '—', color: 'var(--ff-gold-bright)' },
  ];

  return (
    <>
      <div class="ff-stat-grid">
        {tiles.map((t) => (
          <div class="ff-stat-tile" key={t.label}>
            <div class="ff-stat-tile__value ff-mono" style={{ color: t.color }}>{t.value}</div>
            <div class="ff-stat-tile__label">{t.label}</div>
          </div>
        ))}
      </div>
      <div class="ff-fc-captured">Captured {formatRelative(stats.timestamp)}</div>

      <div class="ff-empty">
        Want to sort or search targets? That now lives directly on the Fight Club
        page in-game, next to the Filters button — the real Attack buttons stay
        live since it reorders the actual page, not a copy here.
      </div>
    </>
  );
}
