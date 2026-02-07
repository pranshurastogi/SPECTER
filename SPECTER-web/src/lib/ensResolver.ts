/**
 * ENS validation utilities for SendPayment.
 * Full resolution is done via backend API (api.resolveEns).
 */

export enum EnsErrorCode {
  INVALID_NAME = "INVALID_NAME",
  NAME_NOT_FOUND = "NAME_NOT_FOUND",
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT = "TIMEOUT",
  UNSUPPORTED_NETWORK = "UNSUPPORTED_NETWORK",
  INVALID_CONTENT_HASH = "INVALID_CONTENT_HASH",
  UNKNOWN = "UNKNOWN",
}

export class EnsResolverError extends Error {
  constructor(
    message: string,
    public code: EnsErrorCode,
    public details?: unknown
  ) {
    super(message);
    this.name = "EnsResolverError";
  }
}

/**
 * Validates ENS name format.
 * @throws {EnsResolverError} if name is invalid
 */
export function validateEnsName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new EnsResolverError(
      "ENS name must be a non-empty string",
      EnsErrorCode.INVALID_NAME
    );
  }

  const trimmed = name.trim();
  if (!trimmed) {
    throw new EnsResolverError(
      "ENS name cannot be empty or whitespace only",
      EnsErrorCode.INVALID_NAME
    );
  }

  const invalidChars = /[<>:"/\\|?*\s]/;
  if (invalidChars.test(trimmed)) {
    throw new EnsResolverError(
      "ENS name contains invalid characters",
      EnsErrorCode.INVALID_NAME
    );
  }

  if (!trimmed.includes(".")) {
    throw new EnsResolverError(
      "ENS name must include a domain extension (e.g., .eth)",
      EnsErrorCode.INVALID_NAME
    );
  }

  if (trimmed.includes("..")) {
    throw new EnsResolverError(
      "ENS name cannot contain consecutive dots",
      EnsErrorCode.INVALID_NAME
    );
  }

  if (trimmed.startsWith(".") || trimmed.endsWith(".")) {
    throw new EnsResolverError(
      "ENS name cannot start or end with a dot",
      EnsErrorCode.INVALID_NAME
    );
  }
}
