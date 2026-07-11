export interface StoredPageTemplate {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly content: string
  readonly metadata: string
  readonly createdBy: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface PageTemplateUpdate {
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly content: string
  readonly metadata: string
  readonly updatedAt: number
}

export interface PageTemplateRepository {
  list(): Promise<readonly StoredPageTemplate[]>
  findById(id: string): Promise<StoredPageTemplate | undefined>
  insert(template: StoredPageTemplate): Promise<void>
  update(id: string, patch: PageTemplateUpdate): Promise<void>
  delete(id: string): Promise<void>
}
