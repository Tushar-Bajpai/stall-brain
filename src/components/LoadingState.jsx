import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'

const steps = [
  '📡 Fetching Lucknow weather data...',
  '📅 Checking local events calendar...',
  '📊 Analyzing footfall patterns...',
  '🧠 AI is calculating your forecast...',
  '✅ Forecast ready!',
]

export default function LoadingState({ active }) {
  const [activeIndex, setActiveIndex] = useState(0)

  // The step ticker only advances while the loading panel is shown; state is
  // never touched synchronously on activation (avoids cascading renders).
  useEffect(() => {
    if (!active) return

    const interval = setInterval(() => {
      setActiveIndex((prev) => {
        if (prev >= steps.length) {
          clearInterval(interval)
          return prev
        }
        return prev + 1
      })
    }, 600)

    return () => clearInterval(interval)
  }, [active])

  const visibleIndex = active ? activeIndex : -1

  return (
    <div className="mt-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-6">
      <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
        Bazaar Brain is working...
      </h3>
      <div className="mt-4 space-y-3">
        {steps.map((step, index) => {
          const isVisible = index <= visibleIndex
          if (!isVisible) return null

          const isActive = index === visibleIndex && visibleIndex < steps.length
          const isDone = index < visibleIndex || visibleIndex >= steps.length

          const textColor = isActive
            ? 'text-[var(--color-primary)] animate-pulse'
            : isDone
              ? 'text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)]'

          return (
            <div
              key={step}
              className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-input)] px-4 py-3"
            >
              {isActive ? (
                <Loader2 className="h-5 w-5 animate-spin text-[var(--color-primary)]" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
              )}
              <span className={`text-sm ${textColor}`}>{step}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
