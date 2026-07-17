import posthog from 'posthog-js'
import { config } from './config'

// Product-analytics layer for the funnel PostHog tracks that Umami can't:
// named events tied to a wallet identity, across a session, that PostHog can
// later assemble into a funnel/retention report. Umami (see index.html)
// keeps doing what it's good at — free, cookieless pageviews/click counts.
//
// Self-erasing like presenceUrl/RequestStrip: unset VITE_POSTHOG_KEY → every
// call below is a no-op. No env var to forget, nothing to break in dev or in
// forks that don't want analytics.
let ready = false

export function initAnalytics() {
  if (!config.posthogKey || ready) return
  posthog.init(config.posthogKey, {
    api_host: config.posthogHost,
    person_profiles: 'identified_only', // don't create a person until identify() — anonymous pageviews stay cheap
    capture_pageview: true,
    autocapture: false, // the app's clicks aren't self-describing (bare cell ids) — every event below is named explicitly instead
  })
  ready = true
}

export function track(event: string, props?: Record<string, unknown>) {
  if (!ready) return
  posthog.capture(event, props)
}

// Ties all of a wallet's activity to one PostHog person, across the session
// and any future ones on the same browser. Address only — never anything
// custodial.
export function identifyWallet(address: string) {
  if (!ready) return
  posthog.identify(address)
}

export function resetAnalytics() {
  if (!ready) return
  posthog.reset()
}
