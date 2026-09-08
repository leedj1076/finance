export type CardAccountCandidate = {
  id: number
  name: string
  owner: string | null
  type: string | null
  active?: boolean
}

function compact(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '')
}

export function cardAccountCandidates(
  accounts: CardAccountCandidate[],
  issuerLabel: string,
  owner: string,
): CardAccountCandidate[] {
  const keyword = compact(issuerLabel.replace(/카드$/, ''))
  return accounts.filter((account) =>
    account.type === 'card' &&
    account.owner === owner &&
    account.active !== false &&
    compact(account.name).includes(keyword),
  )
}

/** Match only an unambiguous owner + issuer pair; never guess across issuers or cards. */
export function suggestCardAccountId(
  accounts: CardAccountCandidate[],
  issuerLabel: string,
  owner: string,
) {
  const issuerMatches = cardAccountCandidates(accounts, issuerLabel, owner)

  if (issuerMatches.length === 1) return issuerMatches[0].id
  return null
}

export function resolveCardAccountId(
  accounts: CardAccountCandidate[],
  issuerLabel: string,
  owner: string,
  selectedId: string | null,
): number | null {
  const candidates = cardAccountCandidates(accounts, issuerLabel, owner)
  if (selectedId === null) return candidates.length === 1 ? candidates[0].id : null
  if (!/^[1-9]\d*$/.test(selectedId)) return null

  const id = Number(selectedId)
  return Number.isSafeInteger(id) && candidates.some((card) => card.id === id) ? id : null
}
