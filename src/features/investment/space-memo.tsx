'use client'

import { useEffect } from 'react'

import { rememberSpace, type Space } from './space'

export function SpaceMemo({ space = 'investment' }: { space?: Space }) {
  useEffect(() => {
    rememberSpace(space)
  }, [space])
  return null
}
