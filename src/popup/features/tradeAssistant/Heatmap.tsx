import { useEffect, useState } from 'preact/hooks';
import { computeHeatmap, listKnownItems, type HeatmapEntry } from '@/shared/analytics/heatmap';

function formatCash(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

// Red → gold → green across the observed sell-price range for the selected item.
function intensityColor(intensity: number): string {
  const hue = intensity * 120; // 0 = red, 60 = gold, 120 = green
  return `hsl(${hue}, 65%, 42%)`;
}

export function Heatmap() {
  const [items, setItems] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [entries, setEntries] = useState<HeatmapEntry[]>([]);

  useEffect(() => {
    listKnownItems().then((list) => {
      setItems(list);
      if (list.length > 0) setSelected(list[0]);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    computeHeatmap(selected).then(setEntries);
  }, [selected]);

  if (items.length === 0) {
    return (
      <div class="ff-empty">
        <strong>No prices seen yet</strong>
        Open the smuggling market in a couple of districts to build the heatmap.
      </div>
    );
  }

  return (
    <div>
      <select class="ff-select" value={selected} onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}>
        {items.map((item) => (
          <option value={item} key={item}>{item}</option>
        ))}
      </select>

      <div class="ff-heatmap-grid">
        {entries.map((entry) => (
          <div
            class="ff-heatmap-tile"
            key={entry.district}
            style={entry.isOrigin ? undefined : { borderColor: intensityColor(entry.intensity) }}
          >
            <div class="ff-heatmap-tile__district">{entry.district}</div>
            <div class="ff-heatmap-tile__price ff-mono" style={{ color: entry.isOrigin ? 'var(--ff-gold-bright)' : intensityColor(entry.intensity) }}>
              {formatCash(entry.price)}
            </div>
            <div class="ff-heatmap-tile__tag">{entry.isOrigin ? 'Origin · Buy' : 'Sell'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
