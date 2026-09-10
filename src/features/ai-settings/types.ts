export type AiKind = 'ledger' | 'budget'

export type AiSettingsValues = {
  commonInstructions: string | null
  ledgerInstructions: string | null
  budgetInstructions: string | null
}

export type AiSettingsState = AiSettingsValues & {
  revision: number
  updatedAt: string | null
}

export type AiSettingsSave = AiSettingsValues & { expectedRevision: number }

export type ResolvedAiInstructions = {
  kind: AiKind
  settingsRevision: number
  defaultsVersion: string
  common: string
  task: string
  commonSource: 'default' | 'custom'
  taskSource: 'default' | 'custom'
}

export type AiPromptPolicy = {
  version: string
  before: string
  after: string
  dataTag: string
}

export type AiPromptInput = {
  version: 1
  kind: AiKind
  instructions: ResolvedAiInstructions
  policyVersion: string
  instructionsHash: string
  prefix: string
  suffix: string
  promptHash: string
}

export type AiWorkerView = {
  id: string
  label: string
  lastSeenAt: string | null
  state: 'ready' | 'offline' | 'upgrade_required'
  promptProtocolVersion: number
  budgetProtocolVersion: number
  configuredModel: string | null
  timeoutMs: number | null
}

export type AiSettingsPageData = {
  settings: AiSettingsState
  defaults: Record<keyof AiSettingsValues, string>
  workers: AiWorkerView[]
  budgetPreviewAvailable: boolean
}

export type AiPromptPreview = {
  kind: AiKind
  month: string
  prefix: string
  dataJson: string
  suffix: string
  promptHash: string
  instructions: ResolvedAiInstructions
  generatedAt: string
  unsaved: boolean
}

export type AiJobPromptView =
  | { state: 'recorded'; preview: AiPromptPreview }
  | { state: 'unrecorded'; kind: AiKind; month: string }
