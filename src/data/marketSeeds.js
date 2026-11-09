// Festival + market event seeds — FIX-1 (Phase 0).
// `date-holidays`' India dataset only ships 6 fixed holidays, so the lunar/Hijri
// festivals — which carry the biggest multipliers (Diwali 1.6, Holi, Eid) — live
// here, with dates verified against multiple panchang sources for 2026.
//
// MAINTENANCE CONTRACT: festival dates shift every year (lunar calendar).
// Before each season, re-verify and extend for the new year. Sourcing rule:
// cross-check at least two independent panchang calendars before adding a date.
// A wrong boost on the wrong day is worse than a neutral day — never guess.
// Market events (Mahotsavs) below are UNVERIFIED for 2026 — commented out
// until someone confirms the LMC schedule; uncomment once verified.

export const marketSeeds = [
  // ---- 2026 (verified: panchang cross-check, see notes above) ----
  { date: '2026-01-01', name: 'New Year', type: 'public-holiday', impactMultiplier: 1.15 },
  { date: '2026-01-14', name: 'Makar Sankranti', type: 'festival', impactMultiplier: 1.2 },
  { date: '2026-02-15', name: 'Maha Shivratri', type: 'public-holiday', impactMultiplier: 1.25 },
  { date: '2026-03-04', name: 'Holi', type: 'public-holiday', impactMultiplier: 1.5 },
  { date: '2026-03-19', name: 'Chaitra Navratri Begins', type: 'festival', impactMultiplier: 1.15 },
  { date: '2026-03-21', name: 'Eid al-Fitr', type: 'public-holiday', impactMultiplier: 1.5 },
  { date: '2026-03-26', name: 'Ram Navami', type: 'public-holiday', impactMultiplier: 1.25 },
  { date: '2026-05-01', name: 'Buddha Purnima', type: 'public-holiday', impactMultiplier: 1.2 },
  { date: '2026-05-27', name: 'Eid al-Adha (Bakrid)', type: 'public-holiday', impactMultiplier: 1.45 },
  { date: '2026-06-26', name: 'Muharram', type: 'public-holiday', impactMultiplier: 0.95 },
  { date: '2026-08-26', name: 'Milad un-Nabi', type: 'public-holiday', impactMultiplier: 1.2 },
  { date: '2026-08-28', name: 'Raksha Bandhan', type: 'public-holiday', impactMultiplier: 1.2 },
  { date: '2026-09-04', name: 'Janmashtami', type: 'public-holiday', impactMultiplier: 1.25 },
  { date: '2026-09-14', name: 'Ganesh Chaturthi', type: 'festival', impactMultiplier: 1.2 },
  { date: '2026-10-11', name: 'Navratri Begins', type: 'festival', impactMultiplier: 1.35 },
  { date: '2026-10-20', name: 'Dussehra', type: 'public-holiday', impactMultiplier: 1.35 },
  { date: '2026-10-29', name: 'Karwa Chauth', type: 'festival', impactMultiplier: 1.15 },
  { date: '2026-11-06', name: 'Dhanteras', type: 'festival', impactMultiplier: 1.3 },
  { date: '2026-11-08', name: 'Diwali', type: 'public-holiday', impactMultiplier: 1.6 },
  { date: '2026-11-10', name: 'Govardhan Puja', type: 'public-holiday', impactMultiplier: 1.35 },
  { date: '2026-11-11', name: 'Bhai Dooj', type: 'festival', impactMultiplier: 1.25 },
  { date: '2026-11-15', name: 'Chhath Puja', type: 'festival', impactMultiplier: 1.3 },
  { date: '2026-11-24', name: 'Guru Nanak Jayanti', type: 'public-holiday', impactMultiplier: 1.2 },

  // ---- Unverified market events — confirm the LMC/Mela schedule, then enable ----
  // { date: 'YYYY-MM-DD', name: 'Hazratganj Mahotsav', type: 'festival', impactMultiplier: 1.35 },
  // { date: 'YYYY-MM-DD', name: 'Lucknow Mahotsav', type: 'festival', impactMultiplier: 1.45 },
  //
  // ---- IPL/LSG home fixtures: intentionally absent. Add per season from the
  // ---- official fixture list; never carry last season's dates forward.
]
