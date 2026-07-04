/**
 * Domain error model — a closed, tagged union. Every failure in the system is
 * one of these shapes, which maps cleanly onto HTTP status codes at the edge.
 */

export type ErrorKind =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal'

export interface AppError {
  readonly kind: ErrorKind
  readonly message: string
  /** Optional field name for validation errors (drives form UX). */
  readonly field?: string
}

export const validationError = (message: string, field?: string): AppError =>
  field === undefined ? { kind: 'validation', message } : { kind: 'validation', message, field }
export const unauthorized = (message = 'Authentication required'): AppError => ({ kind: 'unauthorized', message })
export const forbidden = (message = 'You do not have permission to do that'): AppError => ({ kind: 'forbidden', message })
export const notFound = (message = 'Not found'): AppError => ({ kind: 'not_found', message })
export const conflict = (message: string): AppError => ({ kind: 'conflict', message })
export const rateLimited = (message = 'Too many requests'): AppError => ({ kind: 'rate_limited', message })
export const internal = (message = 'Internal error'): AppError => ({ kind: 'internal', message })

/** Map a domain error onto an HTTP status code. The single source of truth. */
export const httpStatus = (error: AppError): number => {
  switch (error.kind) {
    case 'validation':
      return 422
    case 'unauthorized':
      return 401
    case 'forbidden':
      return 403
    case 'not_found':
      return 404
    case 'conflict':
      return 409
    case 'rate_limited':
      return 429
    case 'internal':
      return 500
  }
}
