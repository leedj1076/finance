import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { parseSpace, SPACE_COOKIE, SPACE_HOME } from '@/features/investment/space'

export default async function Home() {
  const store = await cookies()
  redirect(SPACE_HOME[parseSpace(store.get(SPACE_COOKIE)?.value)])
}
