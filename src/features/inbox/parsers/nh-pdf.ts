import type { CardRow } from './cards'
import { parseNhPdfPages, type NhPdfPage } from './nh-pdf-grid'

export class NhPdfError extends Error {
  constructor(public readonly code: 'password_required' | 'password_incorrect' | 'invalid_pdf' | 'unsupported_layout') {
    super({
      password_required: '농협 PDF 명세서 비밀번호를 입력해 주세요.',
      password_incorrect: '농협 PDF 명세서 비밀번호가 맞지 않습니다. 다시 입력해 주세요.',
      invalid_pdf: 'PDF 파일을 읽지 못했습니다. 손상되지 않은 농협 명세서를 다시 선택해 주세요.',
      unsupported_layout: '농협 PDF 거래 표를 정확히 읽지 못했습니다. 지원하는 텍스트 명세서인지 확인하거나 엑셀 명세서를 이용해 주세요.',
    }[code])
    this.name = 'NhPdfError'
  }
}

export function isPdfStatement(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('ascii') === '%PDF-'
}

export async function parseNhPdf(buffer: Buffer, password?: string): Promise<CardRow[]> {
  if (!isPdfStatement(buffer)) throw new NhPdfError('invalid_pdf')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({
    data: new Uint8Array(buffer),
    password: password || undefined,
    // PDF.js 6 removed its eval compiler and the isEvalSupported option.
    // Only text extraction is used; no scripting, rendering or attachments.
    enableXfa: false,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: true,
    verbosity: 0,
  })
  try {
    const document = await task.promise
    const pages: NhPdfPage[] = []
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      pages.push({
        width: page.getViewport({ scale: 1 }).width,
        items: content.items.flatMap((item) => 'str' in item ? [{
          text: item.str, x: item.transform[4], y: item.transform[5], width: item.width,
        }] : []),
      })
      page.cleanup()
    }
    return parseNhPdfPages(pages)
  } catch (error) {
    if (error instanceof NhPdfError) throw error
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new NhPdfError(password ? 'password_incorrect' : 'password_required')
    }
    throw new NhPdfError('invalid_pdf')
  } finally {
    await task.destroy()
  }
}
