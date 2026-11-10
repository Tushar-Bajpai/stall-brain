import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { GripVertical, Plus, X } from 'lucide-react'
import { signOut } from 'firebase/auth'
import Header from '../components/Header'
import StallSelector from '../components/StallSelector'
import { stalls } from '../data/stalls'
import {
  loadProfile,
  normalizeIngredients,
  saveProfile,
} from '../utils/profileStorage'
import { clearForecastSession } from '../utils/forecastSessionStore'
import { saveCloudProfile, loadCloudProfile } from '../utils/cloudStore'
import { auth } from '../utils/firebase'

export default function ProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const storedProfile = useMemo(() => loadProfile(), [])

  const [selectedStallId, setSelectedStallId] = useState(
    storedProfile?.stallType ?? null,
  )
  const [items, setItems] = useState(() => storedProfile?.ingredients ?? [])
  const [newItem, setNewItem] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const selectedStall = stalls.find((stall) => stall.id === selectedStallId)
  const itemCountLabel = `${items.length} default items`
  const bannerMessage = location.state?.banner

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(timer)
  }, [toast])

  // FIX-3/Phase 1: a second browser shows the vendor's saved profile from
  // Firestore. Local cache wins when present (offline-safe); cloud is only
  // fetched when this device has nothing stored.
  useEffect(() => {
    if (storedProfile) return
    let active = true
    loadCloudProfile()
      .then((cloudProfile) => {
        if (!active || !cloudProfile) return
        setSelectedStallId(cloudProfile.stallType)
        setItems(cloudProfile.ingredients)
        saveProfile(cloudProfile) // warm the device cache (fallback path intact)
      })
      .catch(() => {
        // Firestore unreachable (offline): stay on the empty-state flow.
      })
    return () => {
      active = false
    }
  }, [storedProfile])

  const handleSelectStall = (stallId) => {
    const stall = stalls.find((entry) => entry.id === stallId)
    if (!stall) return
    setSelectedStallId(stallId)
    setItems([...stall.items])
    setError('')
  }

  const handleItemChange = (index, value) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
    setError('')
  }

  const handleRemoveItem = (index) => {
    setItems((prev) => prev.filter((_, idx) => idx !== index))
    setError('')
  }

  const handleAddItem = () => {
    const trimmed = newItem.trim()
    if (!trimmed) return
    setItems((prev) => [...prev, trimmed])
    setNewItem('')
    setError('')
  }

  const handleResetDefaults = () => {
    if (!selectedStall) return
    setItems([...selectedStall.items])
    setError('')
  }

  const handleSaveProfile = () => {
    if (!selectedStall) {
      setError('Select a stall type before saving your profile.')
      return
    }

    const cleanedItems = normalizeIngredients(items)
    if (cleanedItems.length < 1) {
      setError('Add at least one ingredient before saving.')
      return
    }

    const saved = saveProfile({
      stallType: selectedStall.id,
      stallLabel: selectedStall.name,
      stallEmoji: selectedStall.emoji,
      ingredients: cleanedItems,
    })

    if (!saved) {
      setError('Unable to save your profile. Please try again.')
      return
    }

    // Phase 1: mirror the profile to Firestore (fire-and-forget — the
    // localStorage copy above is committed and visible; server sync keeps
    // working when the network returns via Firestore's own replay).
    saveCloudProfile(saved).catch(() => {})

    setItems(saved.ingredients)
    setError('')
    setToast('Profile saved! Your stall is ready.')
    navigate('/forecast')
  }

  const handleLogout = async () => {
    clearForecastSession()
    await signOut(auth)
    navigate('/login')
  }

  return (
    <main className="relative min-h-screen">
      {toast ? (
        <div className="fixed right-6 top-6 z-50 rounded-full border border-(--color-success) bg-[rgba(74,222,128,0.16)] px-4 py-2 text-sm font-semibold text-(--color-success)">
          {toast}
        </div>
      ) : null}
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-12 pt-8 sm:px-6 lg:px-10">
        <Header />

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/forecast"
            className="inline-flex items-center rounded-full border border-(--color-border) bg-transparent px-4 py-2 text-sm font-semibold text-(--color-text-secondary) transition hover:bg-(--color-bg-card-hover)"
          >
            Back to Forecast
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-xs uppercase tracking-[0.2em] text-(--color-text-muted)">
              Profile
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center rounded-full border border-(--color-border) bg-transparent px-4 py-2 text-xs font-semibold text-(--color-text-secondary) transition hover:bg-(--color-bg-card-hover)"
            >
              Logout
            </button>
          </div>
        </div>

        {bannerMessage ? (
          <div className="mt-6 rounded-2xl border border-[rgba(251,191,36,0.5)] bg-[rgba(251,191,36,0.12)] px-5 py-4 text-sm text-(--color-text-primary)">
            {bannerMessage}
          </div>
        ) : null}

        <section className="mt-6 rounded-2xl border border-(--color-border) bg-(--color-bg-card) px-6 py-5">
          <h2 className="text-xl font-semibold text-(--color-text-primary)">
            Your Stall Profile
          </h2>
          <p className="mt-1 text-sm text-(--color-text-secondary)">
            This is your permanent stall setup. You can update it anytime.
          </p>
        </section>

        <StallSelector
          stalls={stalls}
          selectedId={selectedStallId}
          onSelect={handleSelectStall}
        />

        {selectedStall ? (
          <section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-(--color-text-primary)">
                  Default ingredients
                </h3>
                <p className="mt-1 text-sm text-(--color-text-secondary)">
                  {itemCountLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={handleResetDefaults}
                className="text-sm font-semibold text-(--color-primary) transition hover:text-(--color-primary-dark)"
              >
                Reset to defaults
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-(--color-border) bg-(--color-bg-card) p-4">
              <div className="max-h-72 space-y-3 overflow-y-auto pr-2">
                {items.length ? (
                  items.map((item, index) => (
                    <div
                      key={`${item}-${index}`}
                      className="flex items-center gap-3 rounded-xl border border-(--color-border) bg-(--color-bg-input) px-3 py-2 focus-within:border-(--color-border-focus)"
                    >
                      <GripVertical className="h-4 w-4 text-(--color-text-muted)" />
                      <input
                        value={item}
                        onChange={(event) =>
                          handleItemChange(index, event.target.value)
                        }
                        className="flex-1 bg-transparent text-sm text-(--color-text-primary) outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(index)}
                        className="rounded-full border border-transparent p-1 text-(--color-text-muted) transition hover:border-(--color-danger) hover:text-(--color-danger)"
                        aria-label="Remove item"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-(--color-border) bg-(--color-bg-input) px-4 py-3 text-sm text-(--color-text-muted)">
                    No items yet. Add at least one item to continue.
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-(--color-border) bg-(--color-bg-input) px-3 py-2 focus-within:border-(--color-border-focus)">
                <input
                  value={newItem}
                  onChange={(event) => setNewItem(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleAddItem()
                    }
                  }}
                  placeholder="Add a new ingredient..."
                  className="flex-1 bg-transparent text-sm text-(--color-text-primary) placeholder:text-(--color-text-muted) outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="inline-flex items-center gap-2 rounded-full bg-(--color-primary) px-3 py-1.5 text-xs font-semibold text-[#0D0D0D] transition hover:bg-(--color-primary-dark)"
                >
                  <Plus className="h-4 w-4" />
                  Add Item
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm text-(--color-danger)">{error}</p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={!selectedStallId}
            className="inline-flex items-center justify-center rounded-full bg-(--color-primary) px-6 py-3 text-base font-semibold text-[#0D0D0D] shadow-[0_0_25px_var(--color-primary-glow)] transition hover:bg-(--color-primary-dark) disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save Profile
          </button>
          <p className="text-sm text-(--color-text-muted)">
            Your profile is saved on this device for quick access.
          </p>
        </div>
      </div>
    </main>
  )
}
