// Runtime event core — FIX-1 (Phase 0).
// The old `events.js` was a static array whose last entries were Dec 2025, so
// eventMultiplier silently became 1.0 forever. Events are now computed:
//   1. Indian national/state holidays from the `date-holidays` package (offline)
//   2. Market-specific seeds (Lucknow city events) from `marketSeeds`
//   3. Fixed weekly footfall pattern
// The exported API is unchanged: getEventsForDate(dateString), getWeeklyMultiplier(dayName).

import Holidays from 'date-holidays'
import { marketSeeds } from './marketSeeds'

const hd = new Holidays()
hd.init('IN', 'UP')

// This build of date-holidays returns ALL holidays of the year when
// getHolidays(year, month, day) is called — the day argument is ignored.
// So: fetch once per year (cached), filter by each entry's own `date`.
const yearCache = new Map()

function getHolidaysForYear(year) {
  if (!yearCache.has(year)) {
    try {
      yearCache.set(year, hd.getHolidays(year))
    } catch {
      yearCache.set(year, [])
    }
  }
  return yearCache.get(year)
}

// Holiday names (date-holidays returns English names) → footfall impact.
// First regex match wins; anything unmatched defaults to a mild holiday bump.
const HOLIDAY_IMPACT = [
  [/diwali/i, 1.6],
  [/holi/i, 1.5],
  [/eid/i, 1.5],
  [/dussehra|dasara|dashain/i, 1.35],
  [/navratri/i, 1.35],
  [/ganesh/i, 1.2],
  [/guru nanak/i, 1.2],
  [/christmas/i, 1.2],
  [/new year/i, 1.15],
  [/independence|republic|gandhi jayanti|ambedkar|labour|budha|buddha|maha shivratri|shivaratri|janmashtami|raksha|muharram|milad|mahavir|good friday/i, 1.2],
]

const DEFAULT_HOLIDAY_IMPACT = 1.2
// Observances (not full public holidays) barely move footfall.
const OBSERVANCE_IMPACT = 1.05

/**
 * @param {string} dateString - 'YYYY-MM-DD' in Asia/Kolkata
 * @returns {{date:string,name:string,type:string,impactMultiplier:number}[]}
 */
export function getEventsForDate(dateString) {
  const [year] = dateString.split('-').map(Number)
  if (!year) return []

  const holidays = getHolidaysForYear(year)
    .filter(
      (entry) =>
        entry.date && entry.date.slice(0, 10) === dateString,
    )
    .map((entry) => {
      const rule = HOLIDAY_IMPACT.find(([regex]) => regex.test(entry.name))
      const isObservance = entry.type === 'observance'
      const impact = isObservance
        ? OBSERVANCE_IMPACT
        : rule
          ? rule[1]
          : DEFAULT_HOLIDAY_IMPACT
      return {
        date: dateString,
        name: entry.name,
        type: isObservance ? 'observance' : 'public-holiday',
        impactMultiplier: impact,
      }
    })

  const seeds = marketSeeds
    .filter((seed) => seed.date === dateString)
    .map((seed) => ({ ...seed, date: dateString }))

  // Same-day merges: keep every event, but never let aggregations double-count.
  // Deterministic: sort by impact descending so `Math.max` at the call site stays
  // stable regardless of source order.
  return [...holidays, ...seeds].sort(
    (a, b) => b.impactMultiplier - a.impactMultiplier,
  )
}

export function getWeeklyMultiplier(dayName) {
  return weeklyPattern[dayName] ?? 1
}

export const weeklyPattern = {
  Monday: 0.8,
  Tuesday: 1,
  Wednesday: 1,
  Thursday: 1,
  Friday: 1.2,
  Saturday: 1.3,
  Sunday: 1.4,
}
