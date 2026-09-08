import type { InboxHistoryRequest } from './history-types'

export function isInboxHistoryRequest(value: unknown): value is InboxHistoryRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as InboxHistoryRequest
  return typeof request.source === 'string' && request.source.length <= 100
    && typeof request.processedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(request.processedOn)
    && ['all', 'pending', 'done', 'dismissed'].includes(request.status)
    && Number.isSafeInteger(request.page) && request.page >= 1
}
