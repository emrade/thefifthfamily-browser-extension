import { useEffect, useRef } from 'preact/hooks';
import { Chart, registerables } from 'chart.js';
import type { ChartSeries } from '@/shared/analytics/timeSeries';

Chart.register(...registerables);

interface MiniChartProps {
  type: 'line' | 'bar';
  series: ChartSeries;
  /** Literal hex, not a CSS custom property — canvas fillStyle/strokeStyle can't
   * resolve var(--...) references the way DOM/CSSOM styles can. */
  color: string;
  /** For bar charts where sign matters (profit can be negative) — colors each bar
   * individually instead of using a single flat `color` for every value, so a loss
   * doesn't render in the same green as a gain with only its position below the
   * zero line to tell them apart. Ignored for line charts. */
  colorForValue?: (value: number) => string;
}

const TICK_COLOR = '#6b6455'; // matches --ff-ink-faint
const GRID_COLOR = 'rgba(201, 168, 76, 0.08)'; // matches --ff-border, faded further

export function MiniChart(props: MiniChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const perValueColors = props.type === 'bar' && props.colorForValue
      ? props.series.values.map(props.colorForValue)
      : null;

    chartRef.current = new Chart(canvasRef.current, {
      type: props.type,
      data: {
        labels: props.series.labels,
        datasets: [
          {
            data: props.series.values,
            backgroundColor: perValueColors ? perValueColors.map((c) => `${c}55`) : props.type === 'bar' ? `${props.color}55` : `${props.color}22`,
            borderColor: perValueColors ?? props.color,
            borderWidth: 1.5,
            borderRadius: props.type === 'bar' ? 3 : 0,
            tension: 0.3,
            fill: props.type === 'line',
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: TICK_COLOR, font: { size: 8 } }, grid: { display: false } },
          y: { ticks: { color: TICK_COLOR, font: { size: 8 } }, grid: { color: GRID_COLOR } },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, [props.series, props.type, props.color, props.colorForValue]);

  return <canvas ref={canvasRef} class="ff-chart-canvas" />;
}
