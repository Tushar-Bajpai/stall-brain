// Firestore CRUD for the vendor surplus/need board — Phase 2 (§2.1/§2.2).
//
// posts/{autoId}:
//   ownerId, marketSlug, kind ('offer' | 'want'), itemLabel, qty, unit,
//   price (number | null), note, contact (poster phone — revealed on interest),
//   status ('open' | 'matched' | 'done'), expiresAt (Timestamp ≤ now + 12h),
//   createdAt (serverTimestamp)
//
// Access is enforced by firestore.rules, not by this UI. Reads for the board
// are a realtime onSnapshot — Firestore realtime is included in the free tier.

import { auth, db } from './firebase'
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { CURRENT_MARKET_SLUG } from '../data/markets'

export const BOARD_MAX_HOURS = 12

function currentUid() {
  return auth?.currentUser?.uid ?? null
}

export function subscribeToMarketBoard({ onUpdate, onError }) {
  if (!currentUid()) {
    onUpdate?.([])
    return () => {}
  }
  const boardQuery = query(
    collection(db, 'posts'),
    where('marketSlug', '==', CURRENT_MARKET_SLUG),
    where('status', '==', 'open'),
    where('expiresAt', '>', new Date()),
    orderBy('expiresAt', 'desc'),
  )
  return onSnapshot(
    boardQuery,
    (snapshot) => {
      onUpdate?.(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })))
    },
    (error) => {
      onError?.(error)
    },
  )
}

/**
 * One active post per (owner, item, kind) — §2.2. Posting over the same
 * (owner, item, kind) overwrites the previous open post (query-then-write).
 */
export async function upsertOwnPost({
  kind,
  itemLabel,
  qty,
  unit,
  price,
  note,
  expiresAt,
  contact,
}) {
  const uid = currentUid()
  if (!uid) return null

  const trimmedItem = typeof itemLabel === 'string' ? itemLabel.trim() : ''
  if (!trimmedItem) return null
  if (kind !== 'offer' && kind !== 'want') return null

  const safeQty = Number(qty)
  const safePrice = Number(price)
  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)

  const payload = {
    ownerId: uid,
    marketSlug: CURRENT_MARKET_SLUG,
    kind,
    itemLabel: trimmedItem,
    qty: Number.isFinite(safeQty) && safeQty > 0 ? safeQty : 0,
    unit: typeof unit === 'string' && unit.trim() ? unit.trim() : 'kg',
    price: Number.isFinite(safePrice) && safePrice > 0 ? safePrice : null,
    note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 140) : '',
    contact: typeof contact === 'string' && contact.trim() ? contact.trim().slice(0, 20) : '',
    status: 'open',
    expiresAt: expiry,
    updatedAt: serverTimestamp(),
  }

  const existing = await getDocs(
    query(
      collection(db, 'posts'),
      where('ownerId', '==', uid),
      where('kind', '==', kind),
      where('itemLabel', '==', trimmedItem),
      where('status', '==', 'open'),
      limit(1),
    ),
  )

  if (!existing.empty) {
    const docRef = doc(db, 'posts', existing.docs[0].id)
    await setDoc(docRef, payload, { merge: true })
    return existing.docs[0].id
  }

  const created = await addDoc(collection(db, 'posts'), {
    ...payload,
    createdAt: serverTimestamp(),
  })
  return created.id
}

export async function closeOwnPost(postId) {
  if (!currentUid() || !postId) return null
  await updateDoc(doc(db, 'posts', postId), {
    status: 'done',
    updatedAt: serverTimestamp(),
  })
  return postId
}
