// FIX-3 (Phase 0): profiles must belong to a signed-in user, not to the browser.
// localStorage is now keyed per user (`bb_<uid>_<key>`). On first load after this
// change, a user's legacy un-seoped profile is migrated into their new key so
// nobody wakes up to an empty app (agent rule 9 — keep the fallback path).

import { scopedKey } from './userScope'

const PROFILE_KEY = 'profile'

export function normalizeIngredients(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function normalizeProfile(profile) {
  if (!profile) return null

  const stallType =
    typeof profile.stallType === 'string' ? profile.stallType.trim() : ''
  const stallLabel =
    typeof profile.stallLabel === 'string' ? profile.stallLabel.trim() : ''
  const stallEmoji =
    typeof profile.stallEmoji === 'string' ? profile.stallEmoji.trim() : ''
  const ingredients = normalizeIngredients(profile.ingredients)

  if (!stallType || !stallLabel || !stallEmoji) return null

  return {
    stallType,
    stallLabel,
    stallEmoji,
    ingredients,
  }
}

function readScopedProfile() {
  try {
    const raw = localStorage.getItem(scopedKey(PROFILE_KEY))
    if (!raw) return null
    return normalizeProfile(JSON.parse(raw))
  } catch {
    return null
  }
}

function migrateLegacyProfile() {
  // One-time adoption of the old shared (un-scoped) key.
  try {
    const raw = localStorage.getItem('bazaarBrain_profile')
    if (!raw) return null
    const migrated = normalizeProfile(JSON.parse(raw))
    if (migrated) {
      localStorage.setItem(scopedKey(PROFILE_KEY), JSON.stringify(migrated))
      // Keep no copies of stale data around after migration.
      localStorage.removeItem('bazaarBrain_profile')
    }
    return migrated
  } catch {
    return null
  }
}

export function loadProfile() {
  if (typeof window === 'undefined') return null
  return readScopedProfile() ?? migrateLegacyProfile()
}

export function saveProfile(profile) {
  if (typeof window === 'undefined') return null

  const normalized = normalizeProfile(profile)
  if (!normalized) return null

  localStorage.setItem(scopedKey(PROFILE_KEY), JSON.stringify(normalized))
  return normalized
}

export function clearProfile() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(scopedKey(PROFILE_KEY))
}
