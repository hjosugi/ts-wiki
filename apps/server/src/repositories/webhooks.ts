export interface WebhookSubscriptionRecord {
  readonly id: string
  readonly name: string
  readonly targetUrl: string
  readonly secret: string
  readonly eventTypes: string
  readonly enabled: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface WebhookSubscriptionChanges {
  readonly name?: string
  readonly targetUrl?: string
  readonly secret?: string
  readonly eventTypes?: string
  readonly enabled?: boolean
  readonly updatedAt: number
}

export interface WebhookSubscriptionRepository {
  findById(id: string): Promise<WebhookSubscriptionRecord | undefined>
  list(): Promise<WebhookSubscriptionRecord[]>
  listEnabled(): Promise<WebhookSubscriptionRecord[]>
  insert(record: WebhookSubscriptionRecord): Promise<void>
  update(id: string, changes: WebhookSubscriptionChanges): Promise<void>
  delete(id: string): Promise<void>
}

export type WebhookDeliveryStatus = 'pending' | 'succeeded' | 'failed'

export interface WebhookDeliveryRecord {
  readonly id: string
  readonly subscriptionId: string
  readonly eventId: string
  readonly eventType: string
  readonly payload: string
  readonly status: WebhookDeliveryStatus
  readonly attempts: number
  readonly nextAttemptAt: number | null
  readonly responseStatus: number | null
  readonly responseBody: string | null
  readonly error: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly deliveredAt: number | null
}

export interface WebhookDeliveryChanges {
  readonly status?: WebhookDeliveryStatus
  readonly attempts?: number
  readonly nextAttemptAt?: number | null
  readonly responseStatus?: number | null
  readonly responseBody?: string | null
  readonly error?: string | null
  readonly updatedAt: number
  readonly deliveredAt?: number | null
}

export interface WebhookDeliveryRepository {
  findById(id: string): Promise<WebhookDeliveryRecord | undefined>
  insert(record: WebhookDeliveryRecord): Promise<void>
  update(id: string, changes: WebhookDeliveryChanges): Promise<void>
  list(status: WebhookDeliveryStatus | undefined, limit: number): Promise<WebhookDeliveryRecord[]>
  listDue(dueAt: number, limit: number, maxAttempts: number): Promise<WebhookDeliveryRecord[]>
}

export type AutomationRuleType = 'event-rule' | 'page-updated-metadata'

export interface AutomationRuleRecord {
  readonly id: string
  readonly name: string
  readonly type: AutomationRuleType
  readonly enabled: boolean
  readonly priority: number
  readonly stopOnMatch: boolean
  readonly config: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface AutomationRuleChanges {
  readonly name?: string
  readonly enabled?: boolean
  readonly priority?: number
  readonly stopOnMatch?: boolean
  readonly config?: string
  readonly updatedAt: number
}

export interface WebhookAutomationRepository {
  findPageById(id: string): Promise<import('./pages.ts').PageRecord | undefined>
  findPageByPath(path: string): Promise<import('./pages.ts').PageRecord | undefined>
  listEnabledRules(): Promise<AutomationRuleRecord[]>
  listRules(): Promise<AutomationRuleRecord[]>
  findRule(id: string): Promise<AutomationRuleRecord | undefined>
  insertRule(record: AutomationRuleRecord): Promise<void>
  updateRule(id: string, changes: AutomationRuleChanges): Promise<void>
  deleteRule(id: string): Promise<void>
}
