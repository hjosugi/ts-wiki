export type AuthProviderKind = 'oidc' | 'saml' | 'ldap'

export interface PublicAuthProvider {
  readonly id: string
  readonly label: string
  readonly kind: AuthProviderKind
  /**
   * Legacy alias kept for clients that still branch on `type`.
   * New code should use `kind`.
   */
  readonly type: AuthProviderKind
  readonly loginUrl: string
}
