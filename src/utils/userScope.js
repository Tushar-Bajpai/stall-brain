// Per-user storage scoping.
// Keep every localStorage write keyed by the signed-in user id so two users
// on the same device never see each other's stall profile or history.
// FIX-3 (Phase 0): all user data gets a `bb_<uid>_*` key once auth state is set.

let activeUid = 'anon'

export function setActiveUser(uid) {
  activeUid = typeof uid === 'string' && uid ? uid : 'anon'
}

export function getActiveUser() {
  return activeUid
}

export function scopedKey(base) {
  return `bb_${activeUid}_${base}`
}
