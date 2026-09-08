export const INBOX_TITLE_MAX_LENGTH = 200

type InboxTitleSource = {
  merchant: string | null
  memo: string | null
}

export function inboxSourceTitle(source: InboxTitleSource) {
  return source.merchant || source.memo || ''
}

export type EditedInboxTitleResult =
  | { title: string; error?: never }
  | { title?: never; error: 'invalid' | 'blank' | 'too-long' }

export function validateEditedInboxTitle(value: unknown): EditedInboxTitleResult {
  if (typeof value !== 'string') return { error: 'invalid' }
  const title = value.trim()
  if (!title) return { error: 'blank' }
  if (title.length > INBOX_TITLE_MAX_LENGTH) return { error: 'too-long' }
  return { title }
}
