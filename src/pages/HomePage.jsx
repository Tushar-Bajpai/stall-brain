import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getWeatherSignal } from '../utils/weatherLogic'
import { getTodayInfo } from '../utils/dateTime'

const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=26.85&longitude=80.95&current=temperature_2m,weathercode,windspeed_10m&daily=weathercode,temperature_2m_max,precipitation_sum&timezone=Asia%2FKolkata&forecast_days=1'
const FALLBACK_WEATHER = {
  temperature: 32,
  weathercode: 0,
}

export default function HomePage() {
  const dateInfo = useMemo(() => getTodayInfo(), [])
  const [weather, setWeather] = useState(null)
  const [weatherSignal, setWeatherSignal] = useState(getWeatherSignal(0))
  const [fallbackWeather, setFallbackWeather] = useState(false)

  useEffect(() => {
    let active = true
    const controller = new AbortController()

    async function fetchWeather() {
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

        if (!active) return

        setWeather({
          temperature: Number.isFinite(temperature)
            ? temperature
            : FALLBACK_WEATHER.temperature,
          weathercode: Number.isFinite(weathercode)
            ? weathercode
            : FALLBACK_WEATHER.weathercode,
        })
        setWeatherSignal(
          getWeatherSignal(Number.isFinite(weathercode) ? weathercode : 0),
        )
        setFallbackWeather(false)
      } catch {
        if (!active) return
        setWeather({ ...FALLBACK_WEATHER })
        setWeatherSignal(getWeatherSignal(FALLBACK_WEATHER.weathercode))
        setFallbackWeather(true)
      }
    }

    fetchWeather()

    return () => {
      active = false
      controller.abort()
    }
  }, [])

  const tempLabel = weather
    ? `${Math.round(weather.temperature)}°C`
    : '--'

  return (
    <main className="relative min-h-screen">
      <div className="home-shimmer" />
      <div className="home-orb home-orb-amber" />
      <div className="home-orb home-orb-emerald" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        <section className="flex flex-1 flex-col justify-center gap-8">
          <div className="flex flex-wrap items-center gap-4">
            <Link
              aria-label="Go to home"
              className="home-logo"
              to="/home"
            >
              BB
            </Link>
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight text-transparent sm:text-5xl lg:text-6xl bg-gradient-to-r from-[#F59E0B] to-[#FBBF24] bg-clip-text">
                Bazaar Brain
              </h1>
              <p className="mt-2 text-base text-[var(--color-text-secondary)] sm:text-lg">
                रोज़ का हिसाब, AI का जवाब
              </p>
            </div>
          </div>

          <p className="max-w-2xl text-lg text-[var(--color-text-secondary)] sm:text-xl">
            Your AI-powered daily stock advisor for Hazratganj vendors.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <Link
              to="/forecast"
              className="inline-flex items-center justify-center rounded-md bg-[var(--color-primary)] px-8 py-4 text-base font-semibold text-[#0D0D0D] shadow-[0_0_30px_var(--color-primary-glow)] transition hover:bg-[var(--color-primary-dark)]"
            >
              Get Today&apos;s Forecast
            </Link>
            <span className="text-sm text-[var(--color-text-muted)]">
              Trusted by Hazratganj street vendors
            </span>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {[
              {
                title: 'Pick your stall type',
                detail: 'Choose from 7 popular Hazratganj vendor profiles.',
              },
              {
                title: 'Review and customize items',
                detail: 'Edit your exact list before forecasting.',
              },
              {
                title: 'Get AI forecast for the day',
                detail: 'Demand signals + Groq reasoning in one view.',
              },
            ].map((step) => (
              <div
                key={step.title}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5"
              >
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {step.title}
                </p>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-5 py-4 text-sm">
          <div className="text-[var(--color-text-secondary)]">
            {dateInfo.dateLabel} - {dateInfo.dayName}
          </div>
          <div className="flex items-center gap-2 text-[var(--color-text-primary)]">
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-input)] px-3 py-1 text-xs">
              Lucknow Weather
            </span>
            <span className="text-sm">
              {tempLabel} · {weatherSignal.label}
              {fallbackWeather ? ' (fallback)' : ''}
            </span>
          </div>
        </div>
      </div>
    </main>
  )
}
