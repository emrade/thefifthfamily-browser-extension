/**
 * Set while Combat Stats → Pet is switching the active pet (reading or spending pet
 * points, background/features/petStatScan.ts). The active pet is the combat
 * pet, and the game refuses to send it on courier runs ("Pigeon is deployed
 * as your combat pet. Unequip it first."), so Pet Couriers skip their turn
 * while this is set rather than trip over a pet that's briefly active.
 */
let switching = false;

export function isSwitchingPets(): boolean {
  return switching;
}

export function setSwitchingPets(on: boolean): void {
  switching = on;
}
