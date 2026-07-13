import { useState } from 'react'

// Launch-day strip pointing at the Product Hunt post. Entirely env-driven so
// this can ship dark: with VITE_PRODUCTHUNT_URL unset it renders nothing, and
// the launch is turned on by setting two Vercel env vars and redeploying.
//
//   VITE_PRODUCTHUNT_URL     full post URL (from the PH "share" box)
//   VITE_PRODUCTHUNT_POST_ID numeric post id (the `post_id=` in PH's embed code)
//   VITE_PRODUCTHUNT_UNTIL   optional ISO date — strip hides itself after this
//
// PH's day ends 11:59pm PT; set UNTIL to 2026-07-15T08:59:00+02:00 and the
// strip disappears on its own without a redeploy.
const PH_URL = (import.meta.env.VITE_PRODUCTHUNT_URL as string | undefined) || ''
const PH_POST_ID = (import.meta.env.VITE_PRODUCTHUNT_POST_ID as string | undefined) || ''
const PH_UNTIL = (import.meta.env.VITE_PRODUCTHUNT_UNTIL as string | undefined) || ''

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
