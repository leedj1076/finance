'use server'

import { requireHousehold } from '@/lib/household'

import { importErrorEvent } from './import-progress'
import { runImport } from './import-service'

export type UploadBanksaladState = { error?: string; message?: string }
export type UploadCardState = UploadBanksaladState

async function upload(mode: 'card' | 'banksalad', data: FormData): Promise<UploadBanksaladState> {
  const household = await requireHousehold()
  if (!household) return { error: '가족 가계부에 연결된 계정이 아닙니다.' }
  try {
    const result = await runImport(household.householdId, mode, data)
    return { message: result.message }
  } catch (error) {
    return { error: importErrorEvent(error).message }
  }
}

export async function uploadBanksaladFiles(_previousState: UploadBanksaladState, formData: FormData): Promise<UploadBanksaladState> {
  return upload('banksalad', formData)
}

export async function uploadCardStatement(formData: FormData): Promise<UploadCardState> {
  return upload('card', formData)
}
