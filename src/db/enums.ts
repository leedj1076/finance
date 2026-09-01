import { pgEnum } from 'drizzle-orm/pg-core'

export const flowEnum = pgEnum('flow', ['income', 'saving', 'expense'])
export const categoryKindEnum = pgEnum('category_kind', ['income', 'saving', 'expense'])
export const inboxStatusEnum = pgEnum('inbox_status', ['pending', 'done', 'dismissed'])
export const inboxKindEnum = pgEnum('inbox_kind', ['normal', 'transfer'])
export const memberRoleEnum = pgEnum('member_role', ['owner', 'member'])
