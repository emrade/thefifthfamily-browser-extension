/**
 * One-time seed for the pet-courier automation's roster table.
 *
 * A pet's `user_pet_id` (needed to draft a shipment) is only visible in the
 * smuggling panel when the account has zero active shipments anywhere — see
 * docs/smuggling-v2-plan.md's "Pet roster discovery" note. This account's archive
 * happened to pass through that state on 2026-08-11/12, so the ids below are
 * pulled from real captures rather than guessed. Run this once after installing
 * the courier feature so the very first "Run" doesn't need to wait for that rare
 * state to recur naturally — after this, the roster keeps itself current on its
 * own (see smugglingV2PanelAdapter.ts / smugglingV2RegexParser.ts).
 *
 * WHERE TO RUN (Firefox): about:debugging#/runtime/this-firefox -> find "The Fifth
 * Family Enhancements" -> click "Inspect" -> the Console tab of the window that
 * opens. Make sure the extension has been rebuilt/reloaded with the courier
 * feature first — this fails if the `petRoster` object store doesn't exist yet.
 */
const KNOWN_PETS = [
  { userPetId: 1983, name: 'Pigeon', tier: 'Tiny express', capacity: 2, travelPenaltyPct: 60 },
  { userPetId: 1984, name: 'Raccoon', tier: 'Small hauler', capacity: 6, travelPenaltyPct: 110 },
  { userPetId: 1996, name: 'Fox', tier: 'Runner', capacity: 5, travelPenaltyPct: 55 },
  { userPetId: 1997, name: 'House Cat', tier: 'Balanced', capacity: 8, travelPenaltyPct: 82 },
  { userPetId: 2207, name: 'Blue Crab', tier: 'Slow freight', capacity: 14, travelPenaltyPct: 150 },
  { userPetId: 2208, name: 'Moray Eel', tier: 'Light courier', capacity: 7, travelPenaltyPct: 80 },
  { userPetId: 2580, name: 'Red-Tailed Hawk', tier: 'Express', capacity: 10, travelPenaltyPct: 60 },
  { userPetId: 2581, name: 'Wild Boar', tier: 'Heavy freight', capacity: 23, travelPenaltyPct: 160 },
  { userPetId: 6829, name: 'George', tier: 'Heavy freight', capacity: 30, travelPenaltyPct: 160 },
];

(async () => {
  const DB_NAME = 'FifthFamilyTradeAssistant';

  const openDb = () =>
    new Promise((resolve, reject) => {
      // No version argument — attaching at whatever version exists on disk, so this
      // never triggers a schema upgrade of its own.
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const db = await openDb();
  if (!db.objectStoreNames.contains('petRoster')) {
    console.error('[seed-pet-roster] no "petRoster" object store — rebuild/reload the extension with the courier feature first, then re-run this');
    db.close();
    return;
  }

  const now = Date.now();
  const tx = db.transaction('petRoster', 'readwrite');
  const store = tx.objectStore('petRoster');
  for (const pet of KNOWN_PETS) {
    store.put({ ...pet, lastSeen: now });
  }

  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  console.log(`[seed-pet-roster] seeded ${KNOWN_PETS.length} pets:`, KNOWN_PETS.map((p) => p.name).join(', '));
  db.close();
})();
