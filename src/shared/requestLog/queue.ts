import { LOG_PREFIX } from '@/shared/log';
import { recordRequest, type RecordRequestInput } from './record';

/**
 * Serializes archive writes onto their own chain, separate from the background
 * worker's feature-message queue.
 *
 * Two things make this its own queue rather than a reuse of the existing one.
 * Writes must be serialized, because the shape index does a read-then-write on
 * `[endpoint+shapeHash]` and concurrent responses carrying a new shape would both
 * read "absent" and both insert it — the same race the feature queue was built to
 * prevent for trades. But they must *not* share the feature queue, because every
 * logged request would then sit in front of the parse-and-store work that actually
 * drives the extension: gzip plus two IndexedDB round-trips per request, added to
 * the latency of every price snapshot and trade. The archive is strictly
 * observational and can afford to lag; the features cannot.
 */
let queue: Promise<void> = Promise.resolve();

/** Background features that read traffic as it's archived (Street Intel
 *  Analytics) — handed every request before it joins the write queue. This
 *  is the one place both page and background traffic pass through. */
const observers: ((input: RecordRequestInput) => void)[] = [];

export function observeRecords(observer: (input: RecordRequestInput) => void): void {
  observers.push(observer);
}

export function enqueueRecord(input: RecordRequestInput): void {
  for (const observe of observers) {
    try {
      observe(input);
    } catch (err) {
      console.error(LOG_PREFIX, 'request observer failed for', input.url, err);
    }
  }
  queue = queue.then(() =>
    recordRequest(input).catch((err) => console.error(LOG_PREFIX, 'request log write failed for', input.url, err)),
  );
}
