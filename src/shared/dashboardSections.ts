/** The Dashboard's sections — each is its own address (`#/<id>`), so a reload
 *  keeps the player where they were, and the popup / "Up next" chip can open
 *  straight to one. */
export const DASHBOARD_SECTIONS = [
  'overview',
  'automations',
  'automations/street-intel',
  'automations/pet-couriers',
  'automations/career-auto',
  'automations/crimes-auto',
  'automations/real-estate-auto',
  'stats',
  'arena',
  'fight-club',
  'http-archive',
  'settings',
] as const;

export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

export const DASHBOARD_PATH = 'src/dashboard/index.html';

export function isDashboardSection(s: string): s is DashboardSection {
  return (DASHBOARD_SECTIONS as readonly string[]).includes(s);
}
