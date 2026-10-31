import { useEffect, useState } from 'preact/hooks';
import { LOG_PREFIX } from '@/shared/log';
import type { StreetIntelAnalytics } from '@/shared/streetIntelAnalytics';
import { ANALYTICS_CSS, renderStreetIntelAnalytics } from '@/shared/streetIntelAnalyticsView';
import type { StreetIntelAutoConfig, StreetIntelAutoStatus } from '@/shared/types';

/** The Analytics section of the popup's Street Intel tab — the same view as
 *  the in-page panel's Analytics tab (see `@/shared/streetIntelAnalyticsView`).
 *  Re-read whenever the auto status changes (a new attempt) or the config
 *  does (the suggestion and greyed rows depend on the minimum). */
export function StreetIntelAnalyticsSection({
  config,
  status,
  onApplyMinimum,
  onApplyExtreme,
}: {
  config: StreetIntelAutoConfig;
  status: StreetIntelAutoStatus | null;
  onApplyMinimum: (value: number) => void;
  /** 0 switches the extreme rule off. */
  onApplyExtreme: (value: number) => void;
}) {
  const [analytics, setAnalytics] = useState<StreetIntelAnalytics | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    chrome.runtime
      .sendMessage({ type: 'street-intel-analytics-requested' })
      .then((a: StreetIntelAnalytics) => {
        if (cancelled) return;
        setAnalytics(a);
        setError(false);
      })
      .catch((err) => {
        console.error(LOG_PREFIX, 'street intel analytics read failed', err);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status?.lastAttempt?.timestamp, config.minCardValue, config.extremeMinEnabled, config.extremeMinValue]);

  if (error && !analytics) return <div class="ff-empty">Could not load analytics — try reopening the popup.</div>;
  if (!analytics) return <div class="ff-empty">Loading analytics…</div>;

  return (
    <>
      <style>{ANALYTICS_CSS}</style>
      <div
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const minimum = target.closest<HTMLButtonElement>('.ff-sia-apply');
          if (minimum?.dataset.value) onApplyMinimum(Number(minimum.dataset.value));
          const extreme = target.closest<HTMLButtonElement>('.ff-sia-apply-extreme');
          if (extreme?.dataset.value) onApplyExtreme(Number(extreme.dataset.value));
        }}
        dangerouslySetInnerHTML={{ __html: renderStreetIntelAnalytics(analytics, config) }}
      />
    </>
  );
}
