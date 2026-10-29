/** Status codes oRPC maps to a built-in error code (shared by v1 and v2). */
const STATUS_TO_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_SUPPORTED',
  406: 'NOT_ACCEPTABLE',
  408: 'TIMEOUT',
  409: 'CONFLICT',
  412: 'PRECONDITION_FAILED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_CONTENT',
  429: 'TOO_MANY_REQUESTS',
  499: 'CLIENT_CLOSED_REQUEST',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
}

export interface ErrorCode {
  code: string
  /** True when oRPC already knows the HTTP status for this code. */
  standard: boolean
}

export function errorCodeForStatus(status: number): ErrorCode {
  const code = STATUS_TO_CODE[status]
  if (code) return { code, standard: true }
  return { code: `HTTP_${status}`, standard: false }
}
