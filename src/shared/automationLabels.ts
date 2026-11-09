import type { AutomationQueueFeature } from './types';

/** Display names for the automation queue, dashboard and "Up next" chip —
 *  the same names the popup already uses for each feature. */
export const AUTOMATION_FEATURE_LABELS: Record<AutomationQueueFeature, string> = {
  'pet-courier': 'Pet Couriers',
  'street-intel': 'Street Intel Auto',
  'career-auto': 'Career Auto',
  'crimes-auto': 'Crimes Auto',
  'real-estate-auto': 'Real Estate Auto-Collect',
  'stock-market': 'Stock Market check',
  'street-racing': 'Street Racing',
  garage: 'Garage',
  inventory: 'Inventory',
  achievements: 'Achievement claims',
  'gold-run': 'Gold Run',
  'stats-refresh': 'Stats refresh',
};
