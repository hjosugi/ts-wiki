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
