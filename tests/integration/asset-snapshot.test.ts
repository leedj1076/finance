import { and, eq, inArray } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'

import { db } from '@/db/client'
import { assetAccounts, balanceSnapshots, households } from '@/db/schema'
import { parseBanksaladWorkbook } from '@/features/inbox/banksalad'
import { uploadBanksaladFiles } from '@/features/inbox/upload-action'

const context = vi.hoisted(() => ({ householdId: '' }))

vi.mock('@/lib/household', () => ({
  requireHousehold: async () => ({
    userId: 'asset-snapshot-test-user',
    householdId: context.householdId,
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const householdIds: string[] = []

async function banksaladBuffer(balance?: number | null) {
  const workbook = new ExcelJS.Workbook()
  const status = workbook.addWorksheet('뱅샐현황')
  status.getCell('B2').value = '이동재'
  status.getCell('C2').value = '남'
  status.getCell('B4').value = '3.재무현황'
  status.getCell('B5').value = '자유입출금 자산'
  status.getCell('E5').value = 100000
  status.getCell('C6').value = '생활비 계좌'
  status.getCell('E6').value = 50000
  status.getCell('B7').value = '저축성 자산'
  status.getCell('C7').value = '주택청약종합저축'
  status.getCell('E7').value = 200000
  status.getCell('C8').value = '정기적금'
  status.getCell('E8').value = 300000
  status.getCell('B9').value = '투자성 자산'
  status.getCell('E9').value = 400000
  status.getCell('B11').value = '6.대출현황'
  status.getCell('B12').value = '담보대출'
  status.getCell('C12').value = '테스트은행'
  status.getCell('D12').value = '주택담보대출'
  status.getCell('G12').value = 500000
  status.getCell('H12').value = 3.5
  status.getCell('J12').value = new Date(Date.UTC(2030, 0, 31))
  if (balance !== undefined) {
    for (const cell of ['E5', 'E6', 'E7', 'E8', 'E9', 'G12']) status.getCell(cell).value = balance
  }

  const ledger = workbook.addWorksheet('가계부 내역')
  ledger.addRow(['날짜', '시간', '타입', '대분류', '소분류', '내용', '금액', '통화', '결제수단', '메모'])
  ledger.addRow([new Date(Date.UTC(2026, 7, 15)), null, '지출', '식비', '외식', '테스트식당', -10000, 'KRW', '테스트카드', null])
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

beforeAll(async () => {
  const created = await db
    .insert(households)
    .values([{ name: 'TEST-assets-current' }, { name: 'TEST-assets-other' }])
    .returning({ id: households.id })
  householdIds.push(...created.map((row) => row.id))
  context.householdId = householdIds[0]
  await db.insert(assetAccounts).values([
    {
      householdId: context.householdId,
      major: '현금',
      name: 'DJ 예금(뱅샐)',
      kind: 'asset',
      sortOrder: 1,
    },
    {
      householdId: householdIds[1],
      major: '현금',
      name: 'DJ 예금(뱅샐)',
      kind: 'asset',
      sortOrder: 1,
    },
  ])
})

afterAll(async () => {
  if (householdIds.length > 0) await db.delete(households).where(inArray(households.id, householdIds))
})

test('parses owner assets, savings, investments, and loans from status sheet', async () => {
  const parsed = await parseBanksaladWorkbook(await banksaladBuffer())
  expect(parsed.status).toEqual({
    owner: 'DJ',
    name: '이동재',
    assets: [
      { group: '현금', label: 'DJ 예금(뱅샐)', amount: 150000 },
      { group: '저축·투자', label: 'DJ 청약', amount: 200000 },
      { group: '저축·투자', label: 'DJ 적금(뱅샐)', amount: 300000 },
      { group: '저축·투자', label: 'DJ 주식(키움)', amount: 400000 },
    ],
    loans: [{
      group: '대출',
      label: '주택담보대출',
      balance: 500000,
      rate: 3.5,
      due: '2030-01-31',
    }],
  })
})

test('default-on upload upserts monthly snapshots without crossing household boundary', async () => {
  const buffer = await banksaladBuffer()
  const formData = new FormData()
  formData.set('files', new File([buffer], 'banksalad.xlsx'))
  formData.set('asset_include', 'on')

  const first = await uploadBanksaladFiles({}, formData)
  expect(first.error).toBeUndefined()
  expect(first.message).toContain('자산 5항목 업데이트')
  expect(first.message).toContain('자동 분류 0건')
  expect(first.message).toContain('확인 필요 1건')
  await uploadBanksaladFiles({}, formData)

  const accounts = await db
    .select({ id: assetAccounts.id, name: assetAccounts.name, major: assetAccounts.major, kind: assetAccounts.kind })
    .from(assetAccounts)
    .where(eq(assetAccounts.householdId, context.householdId))
  expect(accounts).toHaveLength(5)
  expect(accounts.find((row) => row.name === '주택담보대출')).toMatchObject({ major: '대출', kind: 'liability' })

  const snapshots = await db
    .select({ accountId: balanceSnapshots.accountId, amount: balanceSnapshots.amount })
    .from(balanceSnapshots)
    .where(
      and(
        eq(balanceSnapshots.householdId, context.householdId),
        eq(balanceSnapshots.month, '2026-08'),
      ),
    )
  expect(snapshots).toHaveLength(5)
  const amountsByName = new Map(
    snapshots.map((snapshot) => [
      accounts.find((account) => account.id === snapshot.accountId)?.name,
      snapshot.amount,
    ]),
  )
  expect(amountsByName.get('DJ 예금(뱅샐)')).toBe(150000)
  expect(amountsByName.get('주택담보대출')).toBe(500000)

  const foreignSnapshots = await db
    .select({ id: balanceSnapshots.id })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.householdId, householdIds[1]))
  expect(foreignSnapshots).toHaveLength(0)
})

test.each([null, 0])('upload preserves unknown balances but stores explicit zero (%s)', async (balance) => {
  async function upload(buffer: Buffer) {
    const form = new FormData()
    form.set('files', new File([new Uint8Array(buffer)], 'banksalad.xlsx'))
    form.set('asset_include', 'on')
    expect((await uploadBanksaladFiles({}, form)).error).toBeUndefined()
  }
  await upload(await banksaladBuffer())
  const stored = () => db.select({ accountId: balanceSnapshots.accountId, amount: balanceSnapshots.amount })
    .from(balanceSnapshots).where(and(
      eq(balanceSnapshots.householdId, context.householdId), eq(balanceSnapshots.month, '2026-08'),
    )).orderBy(balanceSnapshots.accountId)
  const before = await stored()
  expect(before).toHaveLength(5)
  await upload(await banksaladBuffer(balance))
  expect(await stored()).toEqual(balance === null ? before : before.map((row) => ({ ...row, amount: 0 })))
})

test('mixed zero and unknown products do not erase complete stored aggregates', async () => {
  async function upload(buffer: Buffer) {
    const form = new FormData()
    form.set('files', new File([new Uint8Array(buffer)], 'banksalad.xlsx'))
    form.set('asset_include', 'on')
    expect((await uploadBanksaladFiles({}, form)).error).toBeUndefined()
  }
  await upload(await banksaladBuffer())
  const stored = () => db.select({ accountId: balanceSnapshots.accountId, amount: balanceSnapshots.amount })
    .from(balanceSnapshots).where(and(
      eq(balanceSnapshots.householdId, context.householdId), eq(balanceSnapshots.month, '2026-08'),
    )).orderBy(balanceSnapshots.accountId)
  const before = await stored()
  expect(before).toHaveLength(5)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Uint8Array.from(await banksaladBuffer()).buffer)
  const status = workbook.getWorksheet('뱅샐현황')!
  status.spliceRows(4, status.rowCount - 3,
    [null, '3.재무현황'],
    [null, '자유입출금 자산', null, null, 0],
    [null, null, '미연동 통장', null, null],
    [null, '저축성 자산', '주택청약종합저축', null, 0],
    [null, null, '미연동 주택청약', null, null],
    [null, null, '정기적금', null, 0],
    [null, null, '미연동 적금', null, null],
    [null, '투자성 자산', null, null, 0],
    [null, null, '미연동 증권', null, '조회 불가'],
  )
  await upload(Buffer.from(await workbook.xlsx.writeBuffer()))
  expect(await stored()).toEqual(before)
})
