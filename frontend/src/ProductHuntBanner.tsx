import { useState } from 'react'

// Launch-day strip pointing at the Product Hunt post. The launch is live, so the
// post URL is baked in as the default — merging this is enough to turn the strip
// on; no Vercel env vars, no redeploy dance. Each value is still overridable:
//
//   VITE_PRODUCTHUNT_URL     post URL. Set it to "" to kill the strip early.
//   VITE_PRODUCTHUNT_POST_ID numeric post id (the `post_id=` in PH's embed code).
//                            With it, the CTA becomes PH's official badge; without
//                            it, a chrome "Upvote ↑" button.
//   VITE_PRODUCTHUNT_UNTIL   ISO date after which the strip removes itself.
//
// PH's day ends 11:59pm PT = 08:59 Madrid the next morning, which is what UNTIL
// defaults to — the strip retires itself, nobody has to remember.
const DEFAULT_URL = 'https://www.producthunt.com/products/loopclub?launch=loopclub'
const DEFAULT_UNTIL = '2026-07-15T08:59:00+02:00'

// `??` not `||`: an explicitly-empty env var is a kill switch, not "unset".
const PH_URL = (import.meta.env.VITE_PRODUCTHUNT_URL as string | undefined) ?? DEFAULT_URL
const PH_POST_ID = (import.meta.env.VITE_PRODUCTHUNT_POST_ID as string | undefined) || ''
const PH_UNTIL = (import.meta.env.VITE_PRODUCTHUNT_UNTIL as string | undefined) ?? DEFAULT_UNTIL

const DISMISSED = 'loopclub.ph.dismissed.v1'

export function ProductHuntBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISSED) === '1',
  )

  if (!PH_URL || dismissed) return null
  if (PH_UNTIL && Date.now() > Date.parse(PH_UNTIL)) return null

  const dismiss = () => {
    localStorage.setItem(DISMISSED, '1')
    setDismissed(true)
  }

  return (
    <div className="ph-strip">
      <span className="ph-strip-dot" aria-hidden="true" />
      <span className="ph-strip-text">
        loopclub is live on Product Hunt today.
      </span>
      <span className="ph-strip-text-sm">Live on Product Hunt</span>
      <a
        className="ph-strip-cta"
        href={PH_URL}
        target="_blank"
        rel="noopener"
        data-umami-event="ph-upvote-click"
      >
        {PH_POST_ID ? (
          <img
            className="ph-strip-badge"
            src={`https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=${PH_POST_ID}&theme=dark`}
            alt="loopclub on Product Hunt"
            width={250}
            height={54}
          />
        ) : (
          <span className="btn-chrome btn-chrome--sm">Upvote&nbsp;↑</span>
        )}
      </a>
      <button
        className="ph-strip-close"
        onClick={dismiss}
        aria-label="Dismiss Product Hunt banner"
      >
        ✕
      </button>
    </div>
  )
}
