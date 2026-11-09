import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { X } from 'lucide-react'
import Header from '../components/Header'
import SignalPanel from '../components/SignalPanel'
import ForecastOutput from '../components/ForecastOutput'
import FeedbackBar from '../components/FeedbackBar'
import HistoryLog from '../components/HistoryLog'
import LoadingState from '../components/LoadingState'
import { getEventsForDate, getWeeklyMultiplier } from '../data/events'
import {
  WEATHER_UNAVAILABLE_SIGNAL,
  getWeatherSignal,
} from '../utils/weatherLogic'
import { requestGroqForecast } from '../utils/groqAgent'
import { getTodayInfo } from '../utils/dateTime'
import { loadProfile } from '../utils/profileStorage'
import { scopedKey } from '../utils/userScope'
import {
  createSessionFromProfile,
  INVENTORY_UNITS,
  loadForecastSession,
  saveForecastSession,
} from '../utils/forecastSessionStore'

const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=26.85&longitude=80.95&current=temperature_2m,weathercode,windspeed_10m&daily=weathercode,temperature_2m_max,precipitation_sum&timezone=Asia%2FKolkata&forecast_days=1'
const WEATHER_REFRESH_MS = 30 * 60 * 1000
// Display-only fallback for the weather card while/unless the API responds.
// The SIGNAL on failure is neutral (WEATER_UNAVAILABLE_SIGNAL) — see FIX-6.
const FALLBACK_WEATHER = {
  temperature: 32,
  weathercode: 0,
  windspeed: 8,
}
// FIX-5: cap raised 5 → 50; each entry now stores the full forecast result.
const HISTORY_MAX = 50
const LEGACY_HISTORY_KEY = 'bazaarBrainHistory'

const ERROR_COPY = {
  MISSING_API_KEY: {
    title: 'Connect your Groq key',
    message:
      'Add VITE_GROQ_API_KEY to your environment file and restart the dev server.',
    action: 'I added the key, retry',
  },
  GROQ_REQUEST_FAILED: {
    title: 'Groq is unavailable',
    message: 'We could not reach the Groq API. Try again in a moment.',
    action: 'Retry forecast',
  },
  GROQ_AUTH_FAILED: {
    title: 'Groq key was rejected',
    message:
      'The API key sent to Groq is invalid or revoked (401). Check VITE_GROQ_API_KEY in your .env file — it must start with gsk_ and match a key in your Groq dashboard.',
    action: 'Retry forecast',
  },
  GROQ_MODEL_UNAVAILABLE: {
    title: 'Groq model is not available',
    message:
      'The AI model this app calls was retired or renamed (404 model_not_found). Set VITE_GROQ_MODEL in your .env file to a model listed at console.groq.com and restart the dev server.',
    action: 'Retry forecast',
  },
  GROQ_RATE_LIMITED: {
    title: 'Too many forecast requests',
    message:
      'Groq returned 429 — the free-tier rate limit was hit. Wait about a minute and try again.',
    action: 'Retry forecast',
  },
  GROQ_NETWORK_FAILED: {
    title: 'Network error',
    message:
      'We could not reach the internet to talk to Groq. Check your connection and retry.',
    action: 'Retry forecast',
  },
  GROQ_PARSE_FAILED: {
    title: 'Forecast response was unclear',
    message: 'The AI response did not parse cleanly. Try regenerating.',
    action: 'Regenerate forecast',
  },
  UNKNOWN: {
    title: 'Something went wrong',
    message: 'Please retry the forecast when you are ready.',
    action: 'Retry forecast',
  },
}

function buildInventorySnapshot(items, inventory) {
  return items.reduce((acc, item) => {
    const entry = inventory?.[item] ?? {}
    const quantity = Number(entry.quantity)
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 0
    const unit =
      typeof entry.unit === 'string' && entry.unit.trim()
        ? entry.unit
        : INVENTORY_UNITS[0]
    acc[item] = { quantity: safeQuantity, unit }
    return acc
  }, {})
}

// FIX-3: history lives under a per-user key. First run after this change adopts
// the old shared-key history so nobody loses their saved runs.
function loadHistory() {
  if (typeof window === 'undefined') return []
  try {
    let stored = localStorage.getItem(scopedKey('history'))
    if (!stored) {
      const legacyRaw = localStorage.getItem(LEGACY_HISTORY_KEY)
      if (legacyRaw) {
        localStorage.setItem(scopedKey('history'), legacyRaw)
        localStorage.removeItem(LEGACY_HISTORY_KEY)
        stored = legacyRaw
      }
    }
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(items) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(scopedKey('history'), JSON.stringify(items))
  } catch {
    // History is non-critical: a full/quota-blocked store must not crash the page.
  }
}

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `bb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function getErrorDetails(code) {
  return ERROR_COPY[code] ?? ERROR_COPY.UNKNOWN
}

function loadNetworkError(error) {
  // fetch() only throws TypeError for network failure; everything HTTP-related
  // arrives as a coded error from the agent.
  return error instanceof TypeError && !error.code ? 'GROQ_NETWORK_FAILED' : null
}

// FIX-4: today's forecast survives navigation — cached per stall+day in
// sessionStorage. Returning to the page restores the card instantly.
function loadDayCache(stallId, dateString) {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(
      scopedKey(`forecast-${stallId}-${dateString}`),
    )
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.date !== dateString) return null
    return parsed
  } catch {
    return null
  }
}

function saveDayCache(stallId, dateString, payload) {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(
      scopedKey(`forecast-${stallId}-${dateString}`),
      JSON.stringify({ ...payload, date: dateString }),
    )
  } catch {
    // Session cache is optional — ignore write failures silently.
  }
}

export default function ForecastPage() {
  // Lazy init reads storage synchronously on first render — no mount effects
  // needed for bootstrapping (avoids cascading set-state-in-effect lint errors).
  const [profile] = useState(() => loadProfile())
  const [history, setHistory] = useState(() => loadHistory())
  // FIX-9: the date was frozen at mount inside useMemo. It is now state that
  // re-checks every minute, so a page left open over midnight rolls over
  // (events/weekday change) instead of keeping yesterday's signals.
  const [dateInfo, setDateInfo] = useState(() => getTodayInfo())
  // Session bootstrap mirrors the profile synchronously: prefer the persisted
  // "today" session, else seed it from the saved profile.
  const [sessionIngredients, setSessionIngredients] = useState(() => {
    const stored = loadForecastSession()
    return stored?.sessionIngredients ?? createSessionFromProfile(profile).sessionIngredients
  })
  const [inventory, setInventory] = useState(() => {
    const stored = loadForecastSession()
    return stored?.inventory ?? createSessionFromProfile(profile).inventory
  })
  const [newItem, setNewItem] = useState('')
  const [itemError, setItemError] = useState('')

  const stall = useMemo(() => {
    if (!profile) return null
    return {
      id: profile.stallType,
      name: profile.stallLabel,
      emoji: profile.stallEmoji,
      items: profile.ingredients,
    }
  }, [profile])

  const [phase, setPhase] = useState('loadingSignals')
  const [weather, setWeather] = useState(null)
  const [weatherSignal, setWeatherSignal] = useState(WEATHER_UNAVAILABLE_SIGNAL)
  const [fallbackWeather, setFallbackWeather] = useState(true)
  const [forecast, setForecast] = useState(null)
  const [showHindi, setShowHindi] = useState(false)
  const [errorState, setErrorState] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [currentHistoryId, setCurrentHistoryId] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const weatherAbortRef = useRef(null)

  const eventsToday = useMemo(() => {
    return getEventsForDate(dateInfo.dateString)
  }, [dateInfo.dateString])

  const eventSummary = eventsToday.length
    ? eventsToday.map((event) => event.name).join(' | ')
    : ''
  const eventSummaryForPrompt = eventSummary || 'No special events'
  const eventMultiplier = eventsToday.length
    ? Math.max(...eventsToday.map((event) => event.impactMultiplier))
    : 1
  const weeklyMultiplier = getWeeklyMultiplier(dateInfo.dayName)

  const effectiveWeather = weather ?? FALLBACK_WEATHER
  const effectiveWeatherSignal = weatherSignal
  const demandMultiplier =
    (effectiveWeatherSignal.footfallImpact ?? 1) *
    eventMultiplier *
    weeklyMultiplier

  useEffect(() => {
    // Minute tick: date state re-checks once a minute (FIX-9). Functional state
    // update keeps identity stable until the dateString actually changes.
    const timer = setInterval(() => {
      setDateInfo((prev) => {
        const next = getTodayInfo()
        return next.dateString === prev.dateString ? prev : next
      })
    }, 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    // Persist the live "today" session whenever it changes.
    saveForecastSession({ sessionIngredients, inventory })
  }, [sessionIngredients, inventory])

  const fetchWeather = useCallback(async () => {
    // Abort any in-flight request; the latest call wins.
    weatherAbortRef.current?.abort()
    const controller = new AbortController()
    weatherAbortRef.current = controller

    try {
      const response = await fetch(WEATHER_URL, {
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error('WEATHER_REQUEST_FAILED')
      }
      const data = await response.json()
      const temperature = data?.current?.temperature_2m
      const weathercode = data?.current?.weathercode
      const windspeed = data?.current?.windspeed_10m

      if (weatherAbortRef.current !== controller) return

      setWeather({
        temperature: Number.isFinite(temperature)
          ? temperature
          : FALLBACK_WEATHER.temperature,
        weathercode: Number.isFinite(weathercode)
          ? weathercode
          : FALLBACK_WEATHER.weathercode,
        windspeed: Number.isFinite(windspeed)
          ? windspeed
          : FALLBACK_WEATHER.windspeed,
      })
      setWeatherSignal(
        getWeatherSignal(Number.isFinite(weathercode) ? weathercode : 0),
      )
      setFallbackWeather(false)
      setPhase((prev) => (prev === 'loadingSignals' ? 'signalsReady' : prev))
    } catch {
      // FIX-6: never present a guessed sky as data. On failure the card shows
      // the neutral "Weather data unavailable" signal (1x), not fake 1.2x sun.
      if (weatherAbortRef.current !== controller) return
      setWeather({ ...FALLBACK_WEATHER })
      setWeatherSignal(WEATHER_UNAVAILABLE_SIGNAL)
      setFallbackWeather(true)
      setPhase((prev) => (prev === 'loadingSignals' ? 'signalsReady' : prev))
    }
  }, [])

  useEffect(() => () => {
    // Abort any in-flight weather request when the page unmounts.
    weatherAbortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (!stall) return

    // FIX-8: refresh weather every 30 minutes and whenever the tab becomes
    // visible again — a phone locked at 6am must not show 6am weather at noon.
    // The initial fetch is timer-scheduled (100ms) so state updates never run
    // synchronously inside the effect body.
    const timeout = setTimeout(fetchWeather, 100)
    const interval = setInterval(fetchWeather, WEATHER_REFRESH_MS)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchWeather()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [stall, fetchWeather])

  // Reset-on-change blocks (React's documented "adjust state when a prop
  // changes" pattern): the former reset effects synchronized setState inside
  // useEffect, which cascades renders. Comparing against the previous value
  // during render is the recommended replacement.

  const [prevStallId, setPrevStallId] = useState(null)
  if (stall && prevStallId !== stall.id) {
    setPrevStallId(stall.id)
    setPhase('loadingSignals')
    setWeather(null)
    setWeatherSignal(WEATHER_UNAVAILABLE_SIGNAL)
    setFallbackWeather(true)
    setForecast(null)
    setErrorState(null)
    setShowHindi(false)
    setFeedback(null)
    setCurrentHistoryId(null)
  }

  const [prevDateString, setPrevDateString] = useState(dateInfo.dateString)
  if (prevDateString !== dateInfo.dateString) {
    // FIX-9: midnight rollover — a stale forecast card must not keep claiming
    // to be "today". The cache restore below may re-apply the fresh cached run.
    setPrevDateString(dateInfo.dateString)
    setPhase((prev) => (prev === 'forecastReady' ? 'signalsReady' : prev))
    setForecast(null)
    setErrorState(null)
    setCurrentHistoryId(null)
    setFeedback(null)
  }

  const [prevCacheKey, setPrevCacheKey] = useState(null)
  if (stall && prevCacheKey !== `${stall.id}-${dateInfo.dateString}`) {
    // FIX-4: restore the same-day cached forecast after navigation or a
    // midnight rollover instead of showing an empty state.
    const nextCacheKey = `${stall.id}-${dateInfo.dateString}`
    setPrevCacheKey(nextCacheKey)
    const cached = loadDayCache(stall.id, dateInfo.dateString)
    if (cached?.forecast) {
      setForecast(cached.forecast)
      setCurrentHistoryId(cached.historyId ?? null)
      setFeedback(cached.feedback ?? null)
      setPhase('forecastReady')
    }
  }

  const handleRemoveItem = (itemName) => {
    setSessionIngredients((prev) => prev.filter((item) => item !== itemName))
    setInventory((prev) => {
      const next = { ...prev }
      delete next[itemName]
      return next
    })
    setItemError('')
  }

  const handleAddItem = () => {
    const trimmed = newItem.trim()
    if (!trimmed) return

    setSessionIngredients((prev) => {
      const exists = prev.some(
        (item) => item.toLowerCase() === trimmed.toLowerCase(),
      )
      if (exists) return prev
      return [...prev, trimmed]
    })
    setInventory((prev) => ({
      ...prev,
      [trimmed]: prev[trimmed] ?? { quantity: 0, unit: INVENTORY_UNITS[0] },
    }))
    setNewItem('')
    setItemError('')
  }

  const handleInventoryChange = (itemName, field, value) => {
    setInventory((prev) => {
      const current = prev[itemName] ?? { quantity: 0, unit: INVENTORY_UNITS[0] }
      if (field === 'quantity') {
        const quantity = Number(value)
        return {
          ...prev,
          [itemName]: {
            ...current,
            quantity:
              Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
          },
        }
      }
      return {
        ...prev,
        [itemName]: {
          ...current,
          unit: value,
        },
      }
    })
  }

  const handleForecast = async () => {
    if (!stall) return
    if (sessionIngredients.length < 1) {
      setItemError('Add at least one item to get a forecast.')
      return
    }

    // FIX-7: regenerating the same day updates the existing history entry and
    // preserves its feedback, instead of discarding it and minting a new id.
    const existingEntry = history.find(
      (item) =>
        item.date === dateInfo.dateString && item.stallId === stall.id,
    )
    const entryId = existingEntry?.id ?? createId()
    const keptFeedback = existingEntry?.feedback ?? null

    setPhase('loadingForecast')
    setErrorState(null)
    setForecast(null)
    setShowHindi(false)
    setFeedback(keptFeedback)

    const inventorySnapshot = buildInventorySnapshot(
      sessionIngredients,
      inventory,
    )

    try {
      const result = await requestGroqForecast({
        stall,
        items: sessionIngredients,
        inventory: inventorySnapshot,
        dateLabel: dateInfo.dateLabel,
        dayName: dateInfo.dayName,
        weather: effectiveWeather,
        weatherSignal: effectiveWeatherSignal,
        eventSummary: eventSummaryForPrompt,
        weeklyMultiplier,
        eventMultiplier,
        demandMultiplier: Number(demandMultiplier.toFixed(2)),
      })

      const demandMultiplierValue = Number(demandMultiplier.toFixed(2))
      const newEntry = {
        id: entryId,
        date: dateInfo.dateString,
        dateLabel: dateInfo.dateLabel,
        stallId: stall.id,
        stallName: stall.name,
        expectedCustomers: result.expectedCustomers,
        demandMultiplier: demandMultiplierValue,
        summary: result.summary,
        feedback: keptFeedback,
        inventorySnapshot,
        result,
      }

      setCurrentHistoryId(entryId)
      setHistory((prev) => {
        const filtered = prev.filter(
          (item) => item.date !== newEntry.date || item.stallId !== newEntry.stallId,
        )
        const next = [newEntry, ...filtered].slice(0, HISTORY_MAX)
        saveHistory(next)
        return next
      })

      saveDayCache(stall.id, dateInfo.dateString, {
        forecast: result,
        historyId: entryId,
        feedback: keptFeedback,
      })

      setForecast(result)
      setPhase('forecastReady')
    } catch (error) {
      setErrorState(loadNetworkError(error) ?? error?.code ?? 'UNKNOWN')
      setPhase('error')
    }
  }

  const handleFeedback = (value) => {
    setFeedback(value)
    if (!currentHistoryId) return
    setHistory((prev) => {
      const next = prev.map((item) =>
        item.id === currentHistoryId ? { ...item, feedback: value } : item,
      )
      saveHistory(next)
      return next
    })
    if (stall) {
      saveDayCache(stall.id, dateInfo.dateString, {
        forecast,
        historyId: currentHistoryId,
        feedback: value,
      })
    }
  }

  if (!profile || !stall) {
    return (
      <Navigate
        to="/profile"
        replace
        state={{
          banner: 'Set up your stall profile first to get your forecast.',
        }}
      />
    )
  }

  const errorDetails = errorState ? getErrorDetails(errorState) : null
  const showForecast = Boolean(phase === 'forecastReady' && forecast)
  const showError = Boolean(phase === 'error' && errorDetails)
  const itemsTodayLabel = `${sessionIngredients.length} items today`
  const stockCount = sessionIngredients.filter((item) => {
    const quantity = Number(inventory?.[item]?.quantity ?? 0)
    return Number.isFinite(quantity) && quantity > 0
  }).length

  return (
    <main className="relative min-h-screen">
      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-12 pt-8 sm:px-6 lg:px-10">
        <Header />

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1">
              {dateInfo.dateLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/profile"
              className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-card-hover)]"
            >
              Profile
            </Link>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{stall.emoji}</span>
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-[var(--color-text-muted)]">
                  Stall identity
                </p>
                <p className="text-base font-semibold text-[var(--color-text-primary)]">
                  {stall.name}
                </p>
              </div>
            </div>
            <Link
              to="/profile"
              className="text-sm font-semibold text-[var(--color-primary)] transition hover:text-[var(--color-primary-dark)]"
            >
              Edit in Profile -
            </Link>
          </div>
        </div>

        <SignalPanel
          weather={effectiveWeather}
          weatherSignal={effectiveWeatherSignal}
          eventSummary={eventSummary}
          eventMultiplier={eventMultiplier}
          dayName={dateInfo.dayName}
          dayMultiplier={weeklyMultiplier}
          fallbackWeather={fallbackWeather}
          loading={phase === 'loadingSignals'}
        />

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                Today&apos;s Items
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                These are loaded from your profile. Add or remove items just for
                today - your profile won&apos;t change.
              </p>
            </div>
            <span className="text-sm font-semibold text-[var(--color-text-secondary)]">
              {itemsTodayLabel}
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
            <div className="space-y-3">
              {sessionIngredients.length ? (
                sessionIngredients.map((item) => (
                  <div
                    key={item}
                    className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)] px-4 py-3"
                  >
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                      {item}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item)}
                      className="rounded-full border border-transparent p-1 text-[var(--color-text-muted)] transition hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
                      aria-label={`Remove ${item}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)] px-4 py-3 text-sm text-[var(--color-text-muted)]">
                  Add at least one item to get a forecast.
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 focus-within:border-[var(--color-border-focus)]">
              <input
                value={newItem}
                onChange={(event) => setNewItem(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    handleAddItem()
                  }
                }}
                placeholder="Add item for today..."
                className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
              />
              <button
                type="button"
                onClick={handleAddItem}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[#0D0D0D] transition hover:bg-[var(--color-primary-dark)]"
              >
                +
              </button>
            </div>
          </div>

          {itemError ? (
            <p className="mt-3 text-sm text-[var(--color-danger)]">
              {itemError}
            </p>
          ) : null}
        </section>

        <section className="mt-8">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              What do you already have?
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Tell us what stock you already have. The AI will only recommend
              what you still need to buy.
            </p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {sessionIngredients.map((item) => (
              <div
                key={`inventory-${item}`}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4"
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_110px_130px]">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {item}
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={inventory?.[item]?.quantity ?? 0}
                    onChange={(event) =>
                      handleInventoryChange(item, 'quantity', event.target.value)
                    }
                    placeholder="0 (leave blank if none)"
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                  />
                  <select
                    value={inventory?.[item]?.unit ?? INVENTORY_UNITS[0]}
                    onChange={(event) =>
                      handleInventoryChange(item, 'unit', event.target.value)
                    }
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
                  >
                    {INVENTORY_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            You have stock for {stockCount} of {sessionIngredients.length} items
          </p>
        </section>

        <div className="mt-8">
          <button
            type="button"
            onClick={handleForecast}
            disabled={sessionIngredients.length < 1}
            className="w-full rounded-2xl bg-[var(--color-primary)] px-6 py-4 text-base font-semibold text-[#0D0D0D] shadow-[0_0_30px_var(--color-primary-glow)] transition hover:bg-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Get Today&apos;s Forecast -
          </button>
        </div>

        {phase === 'loadingForecast' ? <LoadingState active /> : null}

        {showForecast ? (
          <ForecastOutput
            forecast={forecast}
            demandMultiplier={demandMultiplier}
            showHindi={showHindi}
            onToggleHindi={() => setShowHindi((prev) => !prev)}
            onRegenerate={handleForecast}
          />
        ) : null}

        {phase === 'forecastReady' ? (
          <FeedbackBar feedback={feedback} onFeedback={handleFeedback} />
        ) : null}

        {showError ? (
          <div className="mt-8 rounded-2xl border border-[var(--color-danger)] bg-[rgba(248,113,113,0.12)] p-6">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {errorDetails.title}
            </h3>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
              {errorDetails.message}
            </p>
            <button
              type="button"
              onClick={handleForecast}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--color-danger)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition hover:bg-[rgba(248,113,113,0.12)]"
            >
              {errorDetails.action}
            </button>
          </div>
        ) : null}

        <HistoryLog
          history={history}
          collapsed={!historyOpen}
          onToggle={() => setHistoryOpen((prev) => !prev)}
        />
      </div>
    </main>
  )
}

