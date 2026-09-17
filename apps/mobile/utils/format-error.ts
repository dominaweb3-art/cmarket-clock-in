export function formatError(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }
  return fallback
}
