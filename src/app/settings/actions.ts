'use server'

import { redirect } from 'next/navigation'

import { createServerSupabase } from '@/lib/supabase/server'

export type PasswordActionState = { error?: string }

export async function changePassword(
  _previousState: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) redirect('/login')

  const currentPassword = typeof formData.get('currentPassword') === 'string' ? String(formData.get('currentPassword')) : ''
  const newPassword = typeof formData.get('newPassword') === 'string' ? String(formData.get('newPassword')) : ''
  const confirmation = typeof formData.get('confirmation') === 'string' ? String(formData.get('confirmation')) : ''
  if (newPassword.length < 8) return { error: '새 비밀번호는 8자 이상이어야 합니다.' }
  if (newPassword !== confirmation) return { error: '새 비밀번호가 서로 일치하지 않습니다.' }
  if (currentPassword === newPassword) return { error: '현재 비밀번호와 다른 비밀번호를 입력해 주세요.' }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (signInError) return { error: '현재 비밀번호가 올바르지 않습니다.' }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
  if (updateError) return { error: updateError.message }
  redirect('/settings?passwordChanged=1')
}
