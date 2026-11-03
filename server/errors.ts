export class ApiError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message = code) { super(message); }
}
export function requireValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new ApiError(404,"NOT_FOUND");
  return value;
}
