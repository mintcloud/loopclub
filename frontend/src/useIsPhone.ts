import { useEffect, useState } from 'react'

// Phone-width viewport, live. Matches the ≤560px breakpoint the banners already
// use for their stacked layout, so copy that swaps to a short form here can't
// disagree with the CSS that lays it out.
const PHONE_QUERY = '(max-width: 560px)'

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY)
    const onChange = () => setIsPhone(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isPhone
}
