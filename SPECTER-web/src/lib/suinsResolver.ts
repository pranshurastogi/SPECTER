/**
 * SuiNS validation utilities for SendPayment.
 * Full resolution is done via backend API (api.resolveSuins).
 */

export enum SuinsErrorCode {
  INVALID_NAME = "INVALID_NAME",
  NAME_NOT_FOUND = "NAME_NOT_FOUND",
  NETWORK_ERROR = "NETWORK_ERROR",
  TIMEOUT = "TIMEOUT",
  UNKNOWN = "UNKNOWN",
}

export class SuinsResolverError extends Error {
  constructor(
    message: string,
    public code: SuinsErrorCode,
    public details?: unknown
  ) {
    super(message);
    this.name = "SuinsResolverError";
  }
}

/**
 * Validates SuiNS name format.
 * @throws {SuinsResolverError} if name is invalid
 */
export function validateSuinsName(name: string): void {
  if (!name || typeof name !== "string") {
    throw new SuinsResolverError(
      "SuiNS name must be a non-empty string",
      SuinsErrorCode.INVALID_NAME
    );
  }

  const trimmed = name.trim();
  if (!trimmed) {
    throw new SuinsResolverError(
      "SuiNS name cannot be empty or whitespace only",
      SuinsErrorCode.INVALID_NAME
    );
  }

  const invalidChars = /[<>:"/\\|?*\s]/;
  if (invalidChars.test(trimmed)) {
    throw new SuinsResolverError(
      "SuiNS name contains invalid characters",
      SuinsErrorCode.INVALID_NAME
    );
  }

  if (!trimmed.endsWith(".sui")) {
    throw new SuinsResolverError(
      "SuiNS name must end with .sui",
      SuinsErrorCode.INVALID_NAME
    );
  }

  if (trimmed.includes("..")) {
    throw new SuinsResolverError(
      "SuiNS name cannot contain consecutive dots",
      SuinsErrorCode.INVALID_NAME
    );
  }

  if (trimmed.startsWith(".")) {
    throw new SuinsResolverError(
      "SuiNS name cannot start with a dot",
      SuinsErrorCode.INVALID_NAME
    );
  }
}
