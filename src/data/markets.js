// Market registry — Phase 2 (pilot: one market only, per §2.3 scaling rule).
// The `markets/{slug}` Firestore collection is the long-term driver (Phase 6),
// but runtime only needs the current market's constants, so they live here.
// Seeding `markets/hazratganj` in the console is optional until Phase 6.

export const CURRENT_MARKET_SLUG = 'hazratganj'

export const CURRENT_MARKET = {
  slug: 'hazratganj',
  name: 'Hazratganj',
  lat: 26.85,
  lon: 80.95,
}
