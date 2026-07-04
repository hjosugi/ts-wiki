/**
 * Bridge domain errors (`Result`/`AppError`) into HTTP responses. Handlers
 * `unwrap()` a Result and, on failure, throw an `HttpError` that the app's
 * single `.onError` hook turns into a typed JSON body + status code.
 */
import { type AppError, type Result, httpStatus, internal } from '@ts-wiki/core'

export class HttpError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message)
    this.name = 'HttpError'
  }
}

/** Unwrap a Result or throw — the only place handlers convert errors to HTTP. */
export const unwrap = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new HttpError(result.error)
  return result.value
}

export interface ErrorBody {
  readonly error: AppError
}

/** Map any thrown error onto a status code + JSON body. */
export const toErrorResponse = (error: unknown): { status: number; body: ErrorBody } => {
  if (error instanceof HttpError) {
    return { status: httpStatus(error.appError), body: { error: error.appError } }
  }
  // Elysia schema validation failure.
  if (error && typeof error === 'object' && (error as { code?: string }).code === 'VALIDATION') {
    const message = (error as { message?: string }).message ?? 'Invalid request'
    return { status: 422, body: { error: { kind: 'validation', message } } }
  }
  return { status: 500, body: { error: internal() } }
}
