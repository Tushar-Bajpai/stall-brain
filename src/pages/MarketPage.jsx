import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '../components/Header'
import { auth } from '../utils/firebase'
import { loadProfile } from '../utils/profileStorage'
import { INVENTORY_UNITS } from '../utils/forecastSessionStore'
import {
  ensureProfileMarket,
  loadCloudProfile,
  saveProfileContactNumber,
} from '../utils/cloudStore'
import {
  ensurePushRegistered,
  notificationPermission,
  notifyPushOnPost,
  requestNotificationPermission,
} from '../utils/pushStore'
import {
  BOARD_MAX_HOURS,
  closeOwnPost,
  subscribeToMarketBoard,
  upsertOwnPost,
} from '../utils/marketStore'

// Phase 2 — vendor network board (§2.1). One shared board for the current
// market: every signed-in vendor posts what they have extra (offer) or what
// they are missing (want). No chat, no taxonomy: free-text item + qty + price.
// All copy is bilingual (English + Hindi, static).

function msToHuman(msLeft) {
  if (msLeft <= 0) return null
  const minutes = Math.floor(msLeft / 60000)
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours > 0 && mins > 0) {
    return `about ${hours}h ${mins}m · लगभग ${hours} घंटे ${mins} मिनट`
  }
  if (hours > 0) return `about ${hours}h · लगभग ${hours} घंटे`
  return `about ${mins}m · लगभग ${mins} मिनट`
}

function nextOccurrence(hour) {
  // "Today 4PM" means: if 4PM today is still ahead, take it; otherwise it is
  // gone for today, so the chip stops being offered (expiry must be > now).
  const target = new Date()
  target.setHours(hour, 0, 0, 0)
  return target.getTime() > Date.now() ? target : null
}

export default function MarketPage() {
  const [posts, setPosts] = useState(null) // null = board still loading
  const [boardError, setBoardError] = useState('')
  const [activeKind, setActiveKind] = useState('offer') // board tab + form kind
  const [itemLabel, setItemLabel] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState(INVENTORY_UNITS[0])
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [expiryKey, setExpiryKey] = useState('1600') // default chip
  const [customExpiry, setCustomExpiry] = useState('')
  const [phone, setPhone] = useState('') // empty after load = not on file yet
  const [contactInput, setContactInput] = useState('')
  const [needsContact, setNeedsContact] = useState(false)
  const [revealed, setRevealed] = useState({}) // postId -> true (contact visible)
  const [formError, setFormError] = useState('')
  const [posting, setPosting] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)

  // Push permission: lazy-sync read; updated only from user-gesture handlers.
  const [pushPermission, setPushPermission] = useState(() => notificationPermission())

  // Ticking clock: re-rendered every 30s from the interval callback so the
  // "expires in" labels and chip availability stay honest. The clock lives in
  // state (not a render-time Date.now()) to keep the render pure.
  const [now, setNow] = useState(() => Date.now())

  // The uid is fixed for the lifetime of this signed-in page (Firestore rules
  // own actual access control; this only feeds the "You" badge).
  const [myUid] = useState(() => auth?.currentUser?.uid ?? null)

  const ownItems = useMemo(() => loadProfile()?.ingredients ?? [], [])


  useEffect(() => {
    // Backfill marketSlug for profiles created before this phase (rules need
    // it) and learn whether the poster already saved a contact number.
    ensureProfileMarket().catch(() => {})
    loadCloudProfile()
      .then((profile) => {
        if (profile?.phone) {
          setPhone(profile.phone)
          setContactInput(profile.phone)
        } else {
          setNeedsContact(true)
        }
      })
      .catch(() => setNeedsContact(true))
  }, [])

  useEffect(() => {
    // Phase 3: a vendor who already granted the permission gets their FCM
    // token (re)registered silently on every board visit — ask for permission
    // only through the banner button, never on page load.
    if (notificationPermission() !== 'granted') return
    ensurePushRegistered().catch(() => {})
  }, [])

  useEffect(() => {
    // Realtime board (single onSnapshot; kind is filtered client-side below).
    const unsubscribe = subscribeToMarketBoard({
      onUpdate: (nextPosts) => {
        setPosts(nextPosts)
        setBoardError('')
      },
      onError: () => {
        setBoardError(
          'The live board could not be loaded. Check your connection · लाइव बोर्ड लोड नहीं हुआ, कनेक्शन जाँचें',
        )
      },
    })
    return () => unsubscribe()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(toastTimer.current)
  }, [toast])

  const openPosts = (posts ?? []).filter((post) => {
    const expiresAt = post?.expiresAt?.toMillis?.() ?? 0
    return expiresAt > now
  })

  const visiblePosts = openPosts.filter((post) => post.kind === activeKind)

  const expiryValue = useMemo(() => {
    if (expiryKey === 'custom') {
      if (!customExpiry) return null
      const [hour, minute] = customExpiry.split(':').map(Number)
      if (!Number.isFinite(hour)) return null
      // Custom times roll to tomorrow when today's slot already passed;
      // anything beyond the 12h board limit is invalid.
      const target = new Date()
      target.setHours(hour, Number.isFinite(minute) ? minute : 0, 0, 0)
      if (target.getTime() <= now) target.setDate(target.getDate() + 1)
      return target
    }
    const hour = Number(expiryKey)
    if (!Number.isFinite(hour)) return null
    const target = nextOccurrence(hour)
    // A chip whose next occurrence already passed is simply invalid now.
    if (!target) return null
    if (target.getTime() - now > BOARD_MAX_HOURS * 3600_000) return null
    return target
  }, [expiryKey, customExpiry, now])

  function showToast(message) {
    setToast(message)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setFormError('')

    const trimmedItem = itemLabel.trim()
    if (!trimmedItem) {
      setFormError('What item is it? · कौन-सी चीज़ है?')
      return
    }

    const trimmedContact = contactInput.trim()
    let phoneOnFile = phone
    if (needsContact || !trimmedContact) {
      if (!trimmedContact) {
        setFormError(
          'Add your phone number so buyers can reach you · अपना फ़ोन नंबर लिखें ताकि ख़रीदार संपर्क कर सकें',
        )
        return
      }
      // Required on the first post; persisted once on the profile doc.
      try {
        const saved = await saveProfileContactNumber(trimmedContact)
        if (!saved) throw new Error('save failed')
        phoneOnFile = saved
        setPhone(saved)
        setNeedsContact(false)
      } catch {
        setFormError(
          'Could not save your number. Try again. · नंबर सेव नहीं हुआ, फिर कोशिश करें',
        )
        return
      }
    }

    const expiryTarget = expiryValue
    if (!expiryTarget || expiryTarget.getTime() <= Date.now()) {
      setFormError(
        'Pick a valid expiry time (within 12 hours) · मान्य समय चुनें (12 घंटे के अंदर)',
      )
      return
    }

    setPosting(true)
    try {
      const created = await upsertOwnPost({
        kind: activeKind,
        itemLabel: trimmedItem,
        qty,
        unit: unit || INVENTORY_UNITS[0],
        price: price.trim() ? price : null,
        note,
        contact: phoneOnFile ?? trimmedContact,
        expiresAt: expiryTarget,
      })
      if (!created) throw new Error('rejected')
      // Phase 3: alert matching neighbors (fire-and-forget, never on failure).
      notifyPushOnPost({
        kind: activeKind,
        itemLabel: trimmedItem,
        itemKey: trimmedItem.toLowerCase(),
        qty: Number(qty) || 0,
        unit: unit || INVENTORY_UNITS[0],
        price: price.trim() ? Number(price) : null,
      })
      setItemLabel('')
      setQty('')
      setPrice('')
      setNote('')
      showToast(
        activeKind === 'offer'
          ? 'Surplus posted · फ़ालतू सामान बोर्ड पर लग गया'
          : 'Request posted · माँग बोर्ड पर लग गई',
      )
    } catch {
      setFormError(
        'Posting failed. Check your connection and retry. · पोस्ट नहीं हुई, कनेक्शन जाँचें',
      )
    } finally {
      setPosting(false)
    }
  }

  async function handleMarkDone(post) {
    try {
      await closeOwnPost(post.id)
      showToast('Marked done · हो गया')
    } catch {
      showToast('Could not update. Retry. · अपडेट नहीं हुआ, फिर कोशिश करें')
    }
  }

  async function handleEnablePush() {
    // §Permission UX: asked from this banner gesture only, not on page load.
    try {
      const result = await requestNotificationPermission()
      setPushPermission(result)
      if (result !== 'granted') {
        showToast('Alerts need browser permission · अलर्ट के लिए अनुमति चाहिए')
        return
      }
      const token = await ensurePushRegistered()
      showToast(
        token
          ? 'Alerts on — neighbors can reach you · अलर्ट चालू'
          : 'Could not activate alerts, retry · अलर्ट चालू नहीं हो सका, फिर कोशिश करें',
      )
    } catch {
      setPushPermission(notificationPermission())
      showToast('Alerts could not be enabled · अलर्ट चालू नहीं हो सके')
    }
  }

  function handleRevealContact(post) {
    setRevealed((prev) => ({ ...prev, [post.id]: true }))
  }

  const isOfferTab = activeKind === 'offer'

  return (
    <main className="relative min-h-screen">
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-12 pt-8 sm:px-6 lg:px-10">
        <Header />

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1">
              <span
                className={`h-2 w-2 rounded-full ${isOfferTab ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}`}
              />
              Hazratganj mandi board · हज़रतगंज मंडी बोर्ड
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/forecast"
              className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-card-hover)]"
            >
              Forecast
            </Link>
            <Link
              to="/profile"
              className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-card-hover)]"
            >
              Profile
            </Link>
          </div>
        </div>

        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
          Post what you have extra, and what you are missing — neighbors in the
          same market respond within hours.
          <br />(अपना फ़ालतू सामान और जो कमी है, दोनों यहाँ लगाएँ — उसी मंडी के
          दुकानदार जवाब देंगे।)
        </p>

        {/* Phase 3: permission UX — enable alerts here, never on app load */}
        {pushPermission === 'default' ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-5 py-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              🔔 Turn on neighbor alerts — get a notification the moment someone
              posts an item you need (or needs yours).
              <br />(साथी दुकानदार को आपकी चीज़ चाहिए होगी तो सीधे ख़बर मिलेगी।)
            </p>
            <button
              type="button"
              onClick={handleEnablePush}
              className="rounded-full bg-[var(--color-primary)] px-4 py-2 text-xs font-bold text-[#0D0D0D] transition hover:bg-[var(--color-primary-dark)]"
            >
              Enable alerts · अलर्ट चालू करें
            </button>
          </div>
        ) : null}
        {pushPermission === 'denied' ? (
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Alerts are blocked in the browser settings — unblock site
            notifications to get neighbor alerts.
            <br />(अलर्ट ब्राउज़र सेटिंग में बंद हैं — साइट नोटिफिकेशन चालू करें।)
          </p>
        ) : null}
        {pushPermission === 'unsupported' ? (
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            Alert support depends on the browser — on iPhone, alerts arrive once
            the app is installed from the home screen (coming soon).
            <br />(iPhone पर अलर्ट ऐप इंस्टॉल करने के बाद आएँगे — जल्द आ रहा है।)
          </p>
        ) : null}

        {boardError ? (
          <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-5 py-3 text-sm text-[var(--color-danger)]">
            {boardError}
          </div>
        ) : null}

        {/* ---------------- Post form ---------------- */}
        <form
          onSubmit={handleSubmit}
          className="mt-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5"
        >
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Post to the board · बोर्ड पर लगाएँ
          </h2>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveKind('offer')}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                isOfferTab
                  ? 'border-[var(--color-success)] bg-[var(--color-bg-card-hover)] text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)]'
              }`}
            >
              🟢 I have surplus · फ़ालतू है
            </button>
            <button
              type="button"
              onClick={() => setActiveKind('want')}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                !isOfferTab
                  ? 'border-[var(--color-danger)] bg-[var(--color-bg-card-hover)] text-[var(--color-text-primary)]'
                  : 'border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)]'
              }`}
            >
              🔴 I need · कम है, चाहिए
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="market-item"
                className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-muted)]"
              >
                Item · चीज़
              </label>
              <input
                id="market-item"
                list="market-item-options"
                value={itemLabel}
                onChange={(event) => setItemLabel(event.target.value)}
                maxLength={80}
                placeholder="Tomatoes / टमाटर"
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
              />
              <datalist id="market-item-options">
                {ownItems.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </div>

            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div>
                <label
                  htmlFor="market-qty"
                  className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-muted)]"
                >
                  Quantity · मात्रा
                </label>
                <input
                  id="market-qty"
                  type="number"
                  min="0"
                  value={qty}
                  onChange={(event) => setQty(event.target.value)}
                  placeholder="5"
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                />
              </div>
              <div>
                <label
                  htmlFor="market-unit"
                  className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-muted)]"
                >
                  Unit · इकाई
                </label>
                <select
                  id="market-unit"
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                >
                  {INVENTORY_UNITS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="market-price"
                className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-muted)]"
              >
                Price ₹ (optional) · दाम (वैकल्पिक)
              </label>
              <input
                id="market-price"
                type="number"
                min="0"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                placeholder="40 per kg"
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
              />
            </div>
            <div>
              {needsContact || !phone ? (
                <>
                  <label
                    htmlFor="market-contact"
                    className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-muted)]"
                  >
                    Your phone (shown only on interest) · आपका नंबर (रुचि होने पर
                    ही दिखेगा)
                  </label>
                  <input
                    id="market-contact"
                    type="tel"
                    value={contactInput}
                    onChange={(event) => setContactInput(event.target.value)}
                    maxLength={20}
                    placeholder="98XXXXXXXX"
                    className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                  />
                </>
              ) : (
                <p className="mt-6 text-xs text-[var(--color-text-muted)]">
                  Contact to be shared on interest: {phone}
                  <br />
                  (रुचि दिखाने पर दिखने वाला नंबर: {phone})
                </p>
              )}
            </div>
          </div>

          <div className="mt-3">
            <label
              htmlFor="market-note"
              className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-muted)]"
            >
              Note (optional) · टिप्पणी (वैकल्पिक)
            </label>
            <input
              id="market-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={140}
              placeholder="Fresh from mandi this morning / सुबह का ताज़ा माल"
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
            />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-[0.2em] text-[var(--color-text-muted)]">
              Expires · समाप्त
            </span>
            {[
              { key: '1200', label: '12 PM' },
              { key: '1600', label: '4 PM' },
              { key: '2000', label: '8 PM' },
            ].map((chip) => {
              const target = nextOccurrence(Number(chip.key))
              const disabled = !target
              return (
                <button
                  key={chip.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => setExpiryKey(chip.key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    expiryKey === chip.key
                      ? 'border-[var(--color-border-focus)] bg-[var(--color-bg-card-hover)] text-[var(--color-text-primary)]'
                      : 'border-[var(--color-border)] bg-transparent text-[var(--color-text-secondary)]'
                  } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  {chip.label}
                </button>
              )
            })}
            <input
              type="time"
              aria-label="Custom expiry time · कस्टम समय"
              value={customExpiry}
              onChange={(event) => {
                setCustomExpiry(event.target.value)
                setExpiryKey('custom')
              }}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
            />
            <span className="text-xs text-[var(--color-text-muted)]">
              (max 12 h · अधिकतम 12 घंटे)
            </span>
          </div>

          {formError ? (
            <p className="mt-3 text-sm text-[var(--color-danger)]">{formError}</p>
          ) : null}

          <button
            type="submit"
            disabled={posting}
            className={`mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-sm font-bold text-[#0D0D0D] transition hover:bg-[var(--color-primary-dark)] ${
              posting ? 'cursor-wait opacity-60' : ''
            }`}
          >
            {posting
              ? 'Posting · लगाया जा रहा है…'
              : isOfferTab
                ? 'Post surplus · फ़ालतू लगाएँ'
                : 'Post request · माँग लगाएँ'}
          </button>
        </form>

        {/* ---------------- Board ---------------- */}
        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Live board · लाइव बोर्ड
            </h2>
            <div className="flex rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] p-1">
              <button
                type="button"
                onClick={() => setActiveKind('offer')}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  isOfferTab
                    ? 'bg-[var(--color-bg-card-hover)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                🟢 Surplus ({openPosts.filter((p) => p.kind === 'offer').length})
              </button>
              <button
                type="button"
                onClick={() => setActiveKind('want')}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  !isOfferTab
                    ? 'bg-[var(--color-bg-card-hover)] text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)]'
                }`}
              >
                🔴 Needed ({openPosts.filter((p) => p.kind === 'want').length})
              </button>
            </div>
          </div>

          {posts === null ? (
            <p className="mt-4 text-sm text-[var(--color-text-muted)]">
              Loading the board · बोर्ड लोड हो रहा है…
            </p>
          ) : visiblePosts.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-text-secondary)]">
              Nothing on this list yet — be the first to post.
              <br />(इस सूची में अभी कुछ नहीं है — पहली पोस्ट आप करें।)
            </p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {visiblePosts.map((post) => {
                const expiresAt = post?.expiresAt?.toMillis?.() ?? 0
                const msLeft = expiresAt - now
                const remaining = msToHuman(msLeft)
                const isOwn = post.ownerId === myUid
                const contact = revealed[post.id] ? post.contact : null

                return (
                  <div
                    key={post.id}
                    className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-[var(--color-text-primary)]">
                          {post.itemLabel}
                        </p>
                        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                          {post.qty} {post.unit}
                          {post.price ? ` · ₹${post.price}` : ''}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                          isOwn
                            ? 'border-[var(--color-border-focus)] text-[var(--color-text-primary)]'
                            : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'
                        }`}
                      >
                        {isOwn ? 'You · आप' : 'Vendor · दुकानदार'}
                      </span>
                    </div>

                    {post.note ? (
                      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        {post.note}
                      </p>
                    ) : null}

                    <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                      {remaining
                        ? `Expires in ${remaining} · समाप्त होगा ${remaining}`
                        : 'Expiring · समाप्त हो रहा है'}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {isOwn ? (
                        <button
                          type="button"
                          onClick={() => handleMarkDone(post)}
                          className="rounded-full border border-[var(--color-border)] px-4 py-1.5 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-card-hover)]"
                        >
                          Mark done · हो गया
                        </button>
                      ) : contact ? (
                        <a
                          href={`tel:${contact}`}
                          className="rounded-full bg-[var(--color-primary)] px-4 py-1.5 text-xs font-bold text-[#0D0D0D] transition hover:bg-[var(--color-primary-dark)]"
                        >
                          📞 Call · कॉल करें · {contact}
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleRevealContact(post)}
                          className="rounded-full border border-[var(--color-border-focus)] px-4 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] transition hover:bg-[var(--color-bg-card-hover)]"
                        >
                          मुझे चाहिए — Milega!
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {toast ? (
          <div
            role="status"
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-5 py-2 text-sm font-semibold text-[var(--color-text-primary)] shadow-xl"
          >
            {toast}
          </div>
        ) : null}
      </div>
    </main>
  )
}
