export type CardAccountCandidate = {
  id: number
  name: string
  owner: string | null
  type: string | null
}

function compact(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '')
}

/** Match only an unambiguous owner + issuer pair; never guess across issuers or cards. */
export function suggestCardAccountId(
  accounts: CardAccountCandidate[],
  issuerLabel: string,
  owner: string,
) {
  const ownerCards = accounts.filter(
    (account) => account.type === 'card' && account.owner === owner,
  )
  const keyword = compact(issuerLabel.replace(/카드$/, ''))
  const issuerMatches = ownerCards.filter((account) => compact(account.name).includes(keyword))

  if (issuerMatches.length === 1) return issuerMatches[0].id
  return null
}
