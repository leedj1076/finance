'use client'

import { useEffect } from 'react'

import { SPACE_COOKIE, SPACE_COOKIE_MAX_AGE, type Space } from './space'

export function SpaceMemo({ space = 'investment' }: { space?: Space }) {
  useEffect(() => {
    document.cookie = `${SPACE_COOKIE}=${space}; path=/; max-age=${SPACE_COOKIE_MAX_AGE}; samesite=lax`
  }, [space])
  return null
}
