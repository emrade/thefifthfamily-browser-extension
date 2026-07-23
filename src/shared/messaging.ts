import type { District, RawStatsPayload } from './types';

/**
 * Raw envelope posted from the MAIN-world fetch/XHR hook (mainWorldHook.ts) to the
 * isolated-world content script (content/index.ts) via window.postMessage. The
 * isolated script owns all parsing — the MAIN-world hook only ever forwards bytes.
 */
export interface CapturedRequest {
  source: 'ff-network-hook';
  method: 'GET' | 'POST';
  url: string;
  requestBody: string | null;
  responseText: string;
  timestamp: number;
}

/**
 * Structured events sent from the isolated content script to the background worker
 * via chrome.runtime.sendMessage, after adapters have parsed a CapturedRequest.
 */
export type ExtensionMessage =
  | { type: 'district-catalog'; districts: District[] }
  | {
      type: 'price-snapshot';
      district: string;
      timestamp: number;
      borderSeizureRisk: number;
      hiddenCargo: { current: number; max: number };
      marketShiftSeconds: number | null;
      entries: { item: string; price: number; type: 'buy' | 'sell'; trendPct: number | null; stash: number }[];
    }
  | { type: 'trade-buy'; item: string; quantity: number; timestamp: number }
  | { type: 'trade-sell'; item: string; quantity: number; sellTotal: number; grossProfit: number; timestamp: number }
  | { type: 'customs-raid-detected'; district: string; bribe: number; timestamp: number }
  | { type: 'customs-resolved'; resolution: 'bribe' | 'run' | 'surrender'; caught: boolean; cargoLost: boolean; jailSeconds: number | null; timestamp: number }
  | { type: 'player-stats'; snapshot: RawStatsPayload }
  | { type: 'travel-started'; destinationCityId: number; method: 'walk' | 'taxi'; travelTimeSeconds: number; timestamp: number }
  | { type: 'travel-cancelled'; timestamp: number };
