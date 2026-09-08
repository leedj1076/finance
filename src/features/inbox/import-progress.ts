export type ImportPhase = 'validating' | 'reading' | 'matching' | 'classifying' | 'saving' | 'finalizing'
export type ImportResult = { message: string; added: number; alreadyProcessed: number; automatic: number; review: number }
export type ImportFailureCode = 'password_required' | 'password_incorrect' | 'invalid_input' | 'processing_failed' | 'connection_lost'
export type ImportEvent =
  | { type: 'stage'; phase: ImportPhase; completed?: number; total?: number }
  | { type: 'heartbeat' }
  | { type: 'result'; result: ImportResult }
  | { type: 'error'; code: ImportFailureCode; message: string }
export type ImportObserver = (event: Extract<ImportEvent, { type: 'stage' }>) => void

const messages: Record<ImportFailureCode, string> = {
  password_required: '명세서 비밀번호를 입력해 주세요.',
  password_incorrect: '비밀번호가 맞지 않습니다. 다시 입력해 주세요.',
  invalid_input: '업로드 입력을 확인하고 다시 시도해 주세요.',
  processing_failed: '파일 처리 중 오류가 발생했습니다. 인박스를 확인한 뒤 다시 시도해 주세요.',
  connection_lost: '연결이 끊겨 완료 여부를 확인하지 못했습니다. 인박스에서 처리 결과를 확인해 주세요.',
}

/** Only explicitly safe, user-facing messages belong in this error. */
export class ImportFailure extends Error {
  constructor(public readonly code: ImportFailureCode, message = messages[code]) {
    super(message)
    this.name = 'ImportFailure'
  }
}

export function importErrorEvent(error: unknown): Extract<ImportEvent, { type: 'error' }> {
  const failure = error instanceof ImportFailure ? error : new ImportFailure('processing_failed')
  return { type: 'error', code: failure.code, message: failure.message }
}
