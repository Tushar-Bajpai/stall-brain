// Firestore persistence (Phase 1) — Firebase Spark plan, no paid products.
//
// Contract with the rest of the app (agent rule 9 — keep the fallback path):
// localStorage stays the offline cache / fallback; these functions mirror data
// to `profiles/{uid}` server-side. Every call returns quickly (or a promise
// the caller fire-and-forgets), so the app keeps working offline.
//
// Data model (mirrors IMPLEMENTATION_PLAN.md §1.1):
//   profiles/{uid}
//   profiles/{uid}/forecasts/{YYYY-MM-DD}   ← one doc per market day
//
// Writes are protected by firestore.rules: only the signed-in owner can touch
// their subtree. A missing/null auth means the helper is a no-op — the local
// cache remains the source of truth until sign-in.

import { auth, db } from './firebase'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { normalizeIngredients } from './profileStorage'
import { CURRENT_MARKET_SLUG } from '../data/markets'

function currentUid() {
  return auth?.currentUser?.uid ?? null
}

function normalizeProfileDoc(data) {
  if (!data) return null
  const stallType = typeof data.stallType === 'string' ? data.stallType.trim() : ''
  const stallLabel =
    typeof data.stallLabel === 'string' ? data.stallLabel.trim() : ''
  const stallEmoji =
    typeof data.stallEmoji === 'string' ? data.stallEmoji.trim() : ''
  const ingredients = normalizeIngredients(data.ingredients)

  if (!stallType || !stallLabel || !stallEmoji) return null

  return {
    stallType,
    stallLabel,
    stallEmoji,
    ingredients,
    phone: typeof data.phone === 'string' ? data.phone.trim() : '',
    marketSlug:
      typeof data.marketSlug === 'string' && data.marketSlug
        ? data.marketSlug
        : CURRENT_MARKET_SLUG,
  }
}

function toProfilePayload(profile) {
  return {
    stallType: profile.stallType,
    stallLabel: profile.stallLabel,
    stallEmoji: profile.stallEmoji,
    ingredients: normalizeIngredients(profile.ingredients),
    // Merge semantics below keep `phone` (set via saveProfileContactNumber)
    // and `marketSlug` intact when ProfilePage re-saves without them.
    marketSlug: CURRENT_MARKET_SLUG,
    updatedAt: serverTimestamp(),
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function saveCloudProfile(profile) {
  const uid = currentUid()
  if (!uid || !profile?.stallType) return null

  await setDoc(doc(db, 'profiles', uid), toProfilePayload(profile), {
    merge: true,
  })
  return profile
}

export async function loadCloudProfile() {
  const uid = currentUid()
  if (!uid) return null

  const snapshot = await getDoc(doc(db, 'profiles', uid))
  if (!snapshot.exists()) return null
  return normalizeProfileDoc(snapshot.data())
}

// Phase 2: the poster's contact number lives on the profile doc and is only
// revealed on a post's "Milega?" action — never exposed in batch UIs.
export async function saveProfileContactNumber(phone) {
  const uid = currentUid()
  if (!uid) return null
  const safePhone = typeof phone === 'string' ? phone.trim().slice(0, 20) : ''
  await setDoc(
    doc(db, 'profiles', uid),
    { phone: safePhone, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return safePhone
}

// Profiles created before the vendor-network phase may lack marketSlug, which
// the board rules compare against. Backfill it (merge) before listing.
export async function ensureProfileMarket() {
  const uid = currentUid()
  if (!uid) return null

  const ref = doc(db, 'profiles', uid)
  const snapshot = await getDoc(ref)
  if (!snapshot.exists()) return null
  if (snapshot.data().marketSlug) return true
  await setDoc(
    ref,
    { marketSlug: CURRENT_MARKET_SLUG, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return true
}

// ---------------------------------------------------------------------------
// Forecast history (one doc per day; regenerate merges into the same doc)
// ---------------------------------------------------------------------------

function toForecastPayload(entry) {
  return {
    stallId: entry.stallId ?? '',
    stallName: entry.stallName ?? '',
    dateLabel: entry.dateLabel ?? '',
    expectedCustomers: Number(entry.expectedCustomers) || 0,
    demandMultiplier: Number(entry.demandMultiplier) || 0,
    summary: entry.summary ?? '',
    feedback: entry.feedback ?? null,
    inventorySnapshot:
      entry.inventorySnapshot && typeof entry.inventorySnapshot === 'object'
        ? entry.inventorySnapshot
        : {},
    result:
      entry.result && typeof entry.result === 'object' ? entry.result : {},
    updatedAt: serverTimestamp(),
  }
}

export async function saveCloudForecast(entry) {
  const uid = currentUid()
  if (!uid || !entry?.date) return null

  // Doc id = the date string ⇒ hard one-per-day uniqueness. Merging preserves
  // the original createdAt so history ordering stays stable across regenerates.
  await setDoc(
    doc(db, 'profiles', uid, 'forecasts', entry.date),
    { ...toForecastPayload(entry), createdAt: serverTimestamp() },
    { merge: true },
  )
  return entry
}

export async function updateCloudForecastFeedback(dateString, feedback) {
  const uid = currentUid()
  if (!uid || !dateString) return null

  await setDoc(
    doc(db, 'profiles', uid, 'forecasts', dateString),
    { feedback, updatedAt: serverTimestamp() },
    { merge: true },
  )
  return feedback
}

export async function loadCloudHistory(maxEntries = 50) {
  const uid = currentUid()
  if (!uid) return []

  const snapshot = await getDocs(
    query(
      collection(db, 'profiles', uid, 'forecasts'),
      orderBy('createdAt', 'desc'),
      limit(maxEntries),
    ),
  )

  // Cloud docs map back into the local history-entry shape; doc id doubles as
  // the entry id (the date string) when no local uuid exists.
  return snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data()
      return {
        id: docSnap.id,
        date: docSnap.id,
        dateLabel: data.dateLabel ?? '',
        stallId: data.stallId ?? '',
        stallName: data.stallName ?? '',
        expectedCustomers: Number(data.expectedCustomers) || 0,
        demandMultiplier: Number(data.demandMultiplier) || 0,
        summary: data.summary ?? '',
        feedback: data.feedback ?? null,
        inventorySnapshot: data.inventorySnapshot ?? {},
        result: data.result ?? null,
      }
    })
    .filter((entry) => entry.stallId)
}
