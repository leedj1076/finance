'use client'

import { useEffect, useRef, useState } from 'react'

import { requestDiagnosisPageData, startDiagnosisPolling } from './client'
import type { DiagnosisErrorCode, DiagnosisPageData, DiagnosisSnapshot, DiagnosisTransaction } from './types'
import styles from './diagnosis-panel.module.css'

const SECTIONS = [
  ['overview', '이달의 총평'],
  ['changes', '지출이 달라진 이유'],
  ['trend', '우리집의 평소와 비교'],
  ['checks', '눈여겨볼 점'],
  ['actions', '다음 달에 해볼 일'],
] as const
const ERROR_MESSAGES: Record<DiagnosisErrorCode, string> = {
  timeout: '진단 시간이 길어져 중단됐어요.',
  invalid_output: '보고서를 완성하지 못했어요.',
  cli_failed: '진단을 마치지 못했어요. Mac 연결을 확인한 뒤 다시 시도해 주세요.',
  worker_stopped: 'Mac에서 진단이 중단됐어요.',
  lease_expired: 'Mac 연결이 끊겨 진단이 중단됐어요.',
}

function won(value: number) {
  return `${value.toLocaleString('ko-KR')}원`
}
function manWon(value: number) {
  return `${value < 0 ? '−' : ''}${(Math.abs(value) / 10000).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`
}
function monthLabel(month: string) {
  return `${Number(month.slice(5))}월`
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(value))
}
function relativePercent(value: number, baseline: number | null) {
  if (baseline === null || baseline <= 0) return null
  const percent = (value - baseline) / baseline * 100
  return `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${Math.abs(percent).toFixed(1)}%`
}

function Cashflow({ snapshot }: { snapshot: DiagnosisSnapshot }) {
  const { current } = snapshot
  const missingSalary = current.salaryCount === 0
  const steps = [
    { label: `${monthLabel(snapshot.month)} 월급`, value: current.salary, sign: '', note: missingSalary ? '월급으로 분류된 내역 없음' : won(current.salary) },
    { label: '지출', value: current.expense, sign: '−', note: won(current.expense) },
    { label: '저축·투자 납입', value: current.saving, sign: '−', note: won(current.saving) },
    { label: missingSalary ? '월급 기준 계산 보류' : current.salaryRemainder < 0 ? '기록상 부족한 금액' : '기록상 남은 금액', value: missingSalary ? null : current.salaryRemainder, sign: '=', note: missingSalary ? '월급 분류를 확인해 주세요' : won(current.salaryRemainder) },
  ]
  return (
    <section className={styles.cashflow} aria-labelledby="diagnosis-cashflow-title">
      <div className={styles.sectionHeading}>
        <h3 id="diagnosis-cashflow-title">월급으로 지출과 저축을 감당했을까?</h3>
        <span>{monthLabel(snapshot.month)} 월급 기준</span>
      </div>
      <div className={styles.cashGrid}>
        {steps.map((step, index) => (
          <div className={`${styles.cashStep} ${index === 3 ? styles.cashResult : ''}`} key={step.label}>
            <p className={styles.cashLabel}>{step.sign && <span aria-hidden="true">{step.sign}</span>}{step.label}</p>
            <p className={styles.cashValue}>{step.value === null ? '—' : <>{manWon(step.value)}<small>만 원</small></>}</p>
            <p className={styles.cashNote}>{step.note}</p>
          </div>
        ))}
      </div>
      {missingSalary ? (
        <p className={styles.cashContext}>월급으로 분류된 수입이 없어요. 전체 수입 {won(current.income)}에서 지출과 저축·투자 납입을 뺀 차액은 {won(current.totalRemainder)}입니다.</p>
      ) : (
        <p className={styles.cashContext}>월급 외 수입 <strong>{won(current.otherIncome)}</strong>까지 포함한 전체 수입 기준 차액은 <strong>{won(current.totalRemainder)}</strong>입니다.</p>
      )}
      <p className={styles.finePrint}>기록상 차액으로, 계좌 잔액이나 미결제 카드대금·예정 납부를 반영한 실제 가용 현금과는 다릅니다.</p>
    </section>
  )
}

function Trend({ snapshot }: { snapshot: DiagnosisSnapshot }) {
  const history = snapshot.months.some((month) => month.month === snapshot.month)
    ? snapshot.months
    : [...snapshot.months, snapshot.current]
  const maximum = Math.max(...history.filter((month) => month.count > 0).map((month) => month.expense), 1)
  const { comparison, current } = snapshot
  const overall = relativePercent(current.expense, comparison.expenseAverage)
  const comparable = relativePercent(current.comparableExpense, comparison.comparableExpenseAverage)
  return (
    <>
      <figure className={styles.trendChart} aria-label="최근 월별 지출">
        <figcaption>월별 전체 지출 <span>만 원</span></figcaption>
        {history.map((month) => (
          <div className={styles.trendRow} key={month.month}>
            <span>{monthLabel(month.month)}{month.month === snapshot.month && <small>이번 달</small>}</span>
            <div className={styles.trendTrack} aria-hidden="true">
              {month.count > 0 && <i className={month.month === snapshot.month ? styles.currentBar : ''} style={{ width: `${Math.max(0, month.expense) / maximum * 100}%` }} />}
            </div>
            <strong>{month.count === 0 ? '내역 없음' : manWon(month.expense)}</strong>
          </div>
        ))}
      </figure>
      {comparison.baselineMonthCount === 0 ? (
        <p className={styles.mutedNote}>비교할 월의 내역이 없어요. 이번 달 기록을 기준으로 살펴봤습니다.</p>
      ) : (
        <div className={styles.trendComparisons}>
          <div><p>기록이 있는 {comparison.baselineMonthCount}개월 평균과 비교</p><strong>{overall ?? '비율 계산 불가'}</strong><span>월평균 {won(Math.round(comparison.expenseAverage ?? 0))}</span></div>
          <div><p>여행·경조사를 양쪽에서 제외</p><strong>{comparable ?? '비율 계산 불가'}</strong><span>같은 기준 월평균 {won(Math.round(comparison.comparableExpenseAverage ?? 0))}</span></div>
        </div>
      )}
    </>
  )
}

function EvidenceDialog({ title, rows, onClose }: { title: string; rows: DiagnosisTransaction[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  return (
    <dialog aria-labelledby="diagnosis-evidence-title" className={styles.dialog} ref={dialog} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close() }}>
      <div className={styles.dialogHeading}>
        <div><p className={styles.sectionIndex}>진단에 사용한 기록</p><h3 id="diagnosis-evidence-title">{title}</h3></div>
        <button type="button" aria-label="근거 내역 닫기" className={styles.closeButton} onClick={() => dialog.current?.close()}>×</button>
      </div>
      <p className={styles.mutedNote}>진단 당시 저장된 내역입니다. 이후 수정한 내용은 다시 진단하면 반영됩니다.</p>
      <ul className={styles.evidenceList}>
        {rows.map((row) => (
          <li key={row.id}><div><span>{row.date} · {row.major}{row.sub && ` › ${row.sub}`}</span><strong>{row.merchant || '가맹점 미입력'}</strong>{row.memo && row.memo !== row.merchant && <span>{row.memo}</span>}</div><div><strong>{won(row.amount)}</strong><span>{row.flow === 'income' ? '수입' : row.flow === 'saving' ? '저축·투자 납입' : '지출'}</span></div></li>
        ))}
      </ul>
      <p className={styles.dialogTotal}>선택한 근거 {rows.length}건</p>
    </dialog>
  )
}

function ReportBody({ completed, onEvidence }: { completed: NonNullable<DiagnosisPageData['completed']>; onEvidence: (title: string, ids: number[]) => void }) {
  const { report, snapshot } = completed
  const month = monthLabel(snapshot.month)
  const transactionIds = new Set(snapshot.transactions.map((row) => row.id))
  function evidenceButton(title: string, ids: number[]) {
    const validIds = [...new Set(ids)].filter((id) => transactionIds.has(id))
    if (!validIds.length) return null
    return <button type="button" className={styles.textButton} onClick={() => onEvidence(title, validIds)}>근거 내역 {validIds.length}건 <span aria-hidden="true">↗</span></button>
  }
  const budget = snapshot.budget.total
  const budgetRatio = budget !== null && budget > 0 ? snapshot.current.expense / budget * 100 : null
  const previousMonth = snapshot.months.filter((item) => item.month < snapshot.month).at(-1)
  return (
    <div className={styles.reportLayout}>
      <div className={styles.reportMain}>
        <section className={styles.overview} id="diagnosis-overview">
          <p className={styles.sectionIndex}>01 · 이달의 총평</p>
          <h3>{report.headline}</h3>
          <p>{report.summary}</p>
        </section>
        <section className={styles.reportSection} id="diagnosis-changes">
          <p className={styles.sectionIndex}>02 · 무엇이 달라졌을까</p>
          <div className={styles.sectionHeading}><h3>지출이 달라진 이유</h3>{previousMonth && snapshot.comparison.previousExpense !== null && <span>{monthLabel(previousMonth.month)} → {month}</span>}</div>
          {snapshot.comparison.expenseDelta !== null && <p className={styles.sectionDescription}>전체 지출은 전월보다 {won(Math.abs(snapshot.comparison.expenseDelta))} {snapshot.comparison.expenseDelta > 0 ? '늘었어요' : snapshot.comparison.expenseDelta < 0 ? '줄었어요' : '차이로 같아요'}.</p>}
          <div className={styles.changes}>
            {report.changes.map((change, index) => {
              const category = snapshot.categories.find((item) => item.major === change.category)
              return (
                <article className={styles.change} key={index}>
                  <span className={styles.changeNumber}>{String(index + 1).padStart(2, '0')}</span>
                  <div><h4>{change.title}</h4><p>{change.body}</p>{evidenceButton(change.title, change.transactionIds)}</div>
                  {category && <div className={styles.changeAmount}><strong>{manWon(category.amount)}<small>만 원</small></strong>{category.delta !== null && <span>전월 대비 {category.delta >= 0 ? '+' : '−'}{manWon(Math.abs(category.delta))}만</span>}</div>}
                </article>
              )
            })}
          </div>
        </section>
        <section className={styles.reportSection} id="diagnosis-trend">
          <p className={styles.sectionIndex}>03 · 평소 추세와 비교</p>
          <h3>우리집의 평소와 비교</h3>
          <p className={styles.sectionDescription}>{report.trend.summary}</p>
          <Trend snapshot={snapshot} />
          {report.trend.caveat && <p className={styles.trendInsight}>{report.trend.caveat}</p>}
        </section>
        <section className={styles.reportSection} id="diagnosis-checks">
          <p className={styles.sectionIndex}>04 · 한 번 더 확인</p>
          <h3>눈여겨볼 점</h3>
          {report.checks.length > 0 ? <div className={styles.checks}>{report.checks.map((check, index) => <article className={styles.check} key={index}><h4>{check.title}</h4><p>{check.body}</p>{evidenceButton(check.title, check.transactionIds)}</article>)}</div> : <p className={styles.sectionDescription}>이번 기록에서 별도로 확인할 항목은 찾지 못했어요.</p>}
          {report.positive && <p className={styles.positive}><strong>잘 이어가고 있는 점</strong>{report.positive}</p>}
        </section>
        <section className={styles.reportSection} id="diagnosis-actions">
          <p className={styles.sectionIndex}>05 · 다음 달 계획</p>
          <h3>다음 달에 해볼 일</h3>
          <ol className={styles.actionList}>{report.actions.map((action, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><div><h4>{action.title}</h4><p>{action.body}</p></div></li>)}</ol>
        </section>
        <details className={styles.method}>
          <summary>분석 기준과 계산 근거</summary>
          <div>
            <p><strong>범위</strong> {snapshot.month} 전체 내역 {snapshot.current.count.toLocaleString('ko-KR')}건. 결제수단·분류·검색 필터와 무관하게 이 달 전체를 집계했습니다. 보고서의 숫자와 근거는 {dateLabel(snapshot.asOf)}에 저장한 기록을 사용합니다.</p>
            <p><strong>월급 기준</strong> 월급으로 분류된 수입 {won(snapshot.current.salary)} − 지출 {won(snapshot.current.expense)} − 저축·투자 납입 {won(snapshot.current.saving)} = {won(snapshot.current.salaryRemainder)}. 저축 납입은 소비 지출에 다시 합산하지 않았습니다.</p>
            <p><strong>전체 수입 기준</strong> 수입 {won(snapshot.current.income)} − 지출 {won(snapshot.current.expense)} − 저축·투자 납입 {won(snapshot.current.saving)} = {won(snapshot.current.totalRemainder)}. 월급 외 수입이 다음 달에도 반복된다고 가정하지 않습니다.</p>
            <p><strong>비교</strong> 대상 월을 제외한 직전 3개월 중 내역이 있는 {snapshot.comparison.baselineMonthCount}개월을 평균에 사용했습니다. 내역이 없는 달은 지출 0원으로 보지 않습니다. 여행·경조사 제외 비교는 이번 달과 비교 월 양쪽에 같은 기준을 적용했습니다.</p>
            <p><strong>근거</strong> 합계는 전체 내역으로 계산하고, 진단에 전달한 세부 근거 {snapshot.evidenceCount.toLocaleString('ko-KR')}건 중 보고서가 참조한 내역을 열어볼 수 있습니다. 예산은 진단 당시의 설정 기준입니다.</p>
            <a href={`/ledger?month=${snapshot.month}&tab=list`}>{month} 전체 내역 보기 →</a>
          </div>
        </details>
      </div>
      <aside className={styles.sidebar} aria-label="보고서 안내">
        <div className={styles.sidebarContents}>
          <p className={styles.sidebarTitle}>이번 달 진단</p>
          <ol className={styles.sectionNav}>{SECTIONS.map(([id, label], index) => <li key={id}><a href={`#diagnosis-${id}`}><span>{String(index + 1).padStart(2, '0')}</span>{label}</a></li>)}</ol>
          {budget !== null && <div className={styles.sideCard}><p className={styles.sideLabel}>카테고리 예산 대비</p><strong className={styles.budgetNumber}>{budgetRatio === null ? '예산 0원' : <>{budgetRatio.toFixed(1)}<small>%</small></>}</strong>{budgetRatio !== null && <div className={styles.budgetTrack}><i style={{ width: `${Math.min(Math.max(budgetRatio, 0), 100)}%` }} /></div>}<div className={styles.budgetDetail}><span>지출 {manWon(snapshot.current.expense)}만</span><span>예산 {manWon(budget)}만</span></div><p>{won(Math.abs(budget - snapshot.current.expense))} {budget >= snapshot.current.expense ? '남음' : '초과'}<br /><span>진단 당시 예산 설정 기준</span></p><a className={styles.textButton} href={`/ledger?month=${snapshot.month}&tab=categories`}>카테고리별로 보기 →</a></div>}
          <div className={styles.sideCard}><p className={styles.sideLabel}>이번 진단의 범위</p><h4>{month} 전체 내역</h4><dl><dt>수입·지출·저축</dt><dd>{snapshot.current.count.toLocaleString('ko-KR')}건</dd><dt>비교 월</dt><dd>{snapshot.comparison.baselineMonthCount > 0 ? `최근 3개월 중 ${snapshot.comparison.baselineMonthCount}개월` : '내역 없음'}</dd></dl><p>월말에 내역을 정리한 뒤 진단하고, 수정 후에는 다시 진단해 보세요.</p></div>
        </div>
      </aside>
    </div>
  )
}

export function DiagnosisPanel({ initialData }: { initialData: DiagnosisPageData }) {
  const [data, setData] = useState(initialData)
  const [submitting, setSubmitting] = useState(false)
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [pollRetry, setPollRetry] = useState(0)
  const [evidence, setEvidence] = useState<{ title: string; rows: DiagnosisTransaction[] } | null>(null)
  const manualRequest = useRef<AbortController | null>(null)
  const month = monthLabel(data.month)
  const active = data.latestJob?.status === 'queued' || data.latestJob?.status === 'running'
  const busy = submitting || active
  const snapshot = data.completed?.snapshot ?? data.currentSnapshot
  const isPartialMonth = snapshot.month === new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Asia/Seoul' }).format(new Date(snapshot.asOf))

  useEffect(() => {
    manualRequest.current?.abort()
    setData(initialData)
    setNetworkError(null)
    setEvidence(null)
  }, [initialData])

  useEffect(() => () => { manualRequest.current?.abort() }, [])

  useEffect(() => {
    if (!active) return
    return startDiagnosisPolling({
      month: data.month,
      immediate: pollRetry > 0,
      onData: (next) => { setData(next); setNetworkError(null) },
      onError: () => setNetworkError('진단 상태를 잠시 불러오지 못했어요. 자동으로 다시 확인합니다.'),
    })
  }, [active, data.month, pollRetry, initialData])

  async function refresh() {
    if (active) { setPollRetry((value) => value + 1); return }
    manualRequest.current?.abort()
    const controller = new AbortController()
    manualRequest.current = controller
    const timeout = setTimeout(() => controller.abort(), 15000)
    try {
      setData(await requestDiagnosisPageData(data.month, 'GET', controller.signal))
      setNetworkError(null)
    } catch {
      setNetworkError('진단 상태를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.')
    } finally { clearTimeout(timeout) }
  }

  async function generate() {
    if (busy || data.setupRequired || data.currentSnapshot.current.count === 0) return
    setSubmitting(true)
    setNetworkError(null)
    manualRequest.current?.abort()
    const controller = new AbortController()
    manualRequest.current = controller
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      setData(await requestDiagnosisPageData(data.month, 'POST', controller.signal))
    } catch (error) {
      setNetworkError(error instanceof Error && error.name !== 'AbortError' ? error.message : '요청 결과를 확인하지 못했어요. 상태를 다시 확인해 주세요.')
    } finally { clearTimeout(timeout); setSubmitting(false) }
  }

  const requestLabel = submitting ? '진단 요청 중…' : data.latestJob?.status === 'queued' ? '진단 대기 중' : data.latestJob?.status === 'running' ? '진단 중…' : data.completed || data.latestJob?.status === 'failed' ? '다시 진단하기' : `${month} AI 진단하기`
  const requestButton = <button type="button" className={styles.primaryButton} disabled={busy || data.setupRequired || data.currentSnapshot.current.count === 0} onClick={generate}>{requestLabel}</button>

  return (
    <section className={styles.panel} aria-labelledby="diagnosis-title">
      <header className={styles.heading}>
        <div><p className={styles.sectionIndex}>MONTHLY REVIEW · {data.month}</p><h2 id="diagnosis-title">{month} AI 진단</h2><p>이번 달의 돈 흐름을 읽고, 다음 달에 해볼 일을 정리합니다.</p></div>
        <div className={styles.headerActions}>{data.completed && <button type="button" className={styles.secondaryButton} onClick={() => window.print()}>인쇄</button>}{requestButton}</div>
      </header>
      <div className={styles.meta}><span>{data.completed ? '진단 당시' : '이 달 전체'} 내역 {snapshot.current.count.toLocaleString('ko-KR')}건 · 필터와 무관한 월 전체 기준{isPartialMonth && ' · 월중 기록 기준'}</span>{data.completed && <span>진단 완료 {dateLabel(data.completed.completedAt)}</span>}</div>
      {networkError && <div className={styles.notice} role="alert"><p>{networkError}</p><button type="button" className={styles.textButton} onClick={refresh}>상태 다시 확인</button></div>}
      {data.isStale && data.completed && <div className={styles.notice}><p><strong>진단 이후 내역이 바뀌었어요.</strong> 현재 보고서는 이전 기록 기준입니다. 다시 진단하면 수정한 내역을 반영합니다.</p></div>}
      {data.setupRequired && <div className={styles.notice}><p><strong>Mac에서 진단 연결을 준비해 주세요.</strong> 한 번 연결하면 이 화면에서 매달 진단을 요청할 수 있어요.</p></div>}
      {active && <div className={styles.progress} role="status" aria-live="polite"><span className={styles.activityDot} aria-hidden="true" /><div><strong>{data.latestJob?.status === 'running' ? '이번 달 보고서를 정리하고 있어요' : data.workerOnline ? '진단을 기다리고 있어요' : 'Mac 연결 대기'}</strong><p>{data.latestJob?.status === 'running' ? '분석이 끝나면 이 화면에 보고서가 표시됩니다.' : data.workerOnline ? '차례가 되면 자동으로 진단을 시작합니다.' : '요청은 저장됐어요. Mac이 켜져 있고 연결되면 자동으로 시작합니다.'}{data.completed && ' 기다리는 동안 이전 보고서를 볼 수 있어요.'}</p></div></div>}
      {data.latestJob?.status === 'failed' && <div className={styles.notice} role="status"><p><strong>{ERROR_MESSAGES[data.latestJob.errorCode ?? 'cli_failed']}</strong> {data.completed ? '이전 보고서는 그대로 남아 있어요. 다시 진단할 수 있습니다.' : '다시 진단하기를 눌러 재요청할 수 있습니다.'}</p></div>}
      <Cashflow snapshot={snapshot} />
      {data.completed ? <ReportBody completed={data.completed} onEvidence={(title, ids) => setEvidence({ title, rows: data.completed!.snapshot.transactions.filter((row) => ids.includes(row.id)) })} /> : !active && <div className={styles.empty}><span aria-hidden="true">✧</span><h3>{data.currentSnapshot.current.count === 0 ? `${month} 내역을 먼저 기록해 주세요` : `아직 ${month} 진단이 없어요`}</h3><p>{data.currentSnapshot.current.count === 0 ? '수입·지출·저축 내역이 쌓이면 한 달의 흐름을 함께 살펴볼 수 있어요.' : '내역 정리를 마쳤다면 진단을 시작해 보세요. 달라진 지출, 평소 추세, 다음 달에 해볼 일을 보고서로 정리해 드려요.'}</p>{data.currentSnapshot.current.count > 0 && requestButton}<p className={styles.emptyFootnote}>내역을 고친 뒤에는 언제든 다시 진단할 수 있어요.</p></div>}
      {evidence && <EvidenceDialog title={evidence.title} rows={evidence.rows} onClose={() => setEvidence(null)} />}
    </section>
  )
}
