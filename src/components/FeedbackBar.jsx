import { ThumbsDown, ThumbsUp } from 'lucide-react'

export default function FeedbackBar({ feedback, onFeedback }) {
  if (feedback) {
    return (
      <div className="mt-6 rounded-2xl border border-[var(--color-success)] bg-[rgba(74,222,128,0.12)] px-5 py-4 text-sm text-[var(--color-text-primary)]">
        Noted — saved to your history.
      </div>
    )
  }

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-5 py-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Was this forecast accurate?
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onFeedback('up')}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-success)] bg-[rgba(74,222,128,0.12)] px-4 py-2 text-sm font-semibold text-[var(--color-success)] transition hover:bg-[rgba(74,222,128,0.2)]"
        >
          <ThumbsUp size={16} />
          Yes
        </button>
        <button
          type="button"
          onClick={() => onFeedback('down')}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-danger)] bg-[rgba(248,113,113,0.12)] px-4 py-2 text-sm font-semibold text-[var(--color-danger)] transition hover:bg-[rgba(248,113,113,0.2)]"
        >
          <ThumbsDown size={16} />
          No
        </button>
      </div>
    </div>
  )
}
