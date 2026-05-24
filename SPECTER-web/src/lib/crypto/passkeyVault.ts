/**
 * SPECTER key vault — WebAuthn passkey unlock via PRF extension.
 *
 * Security model:
 * - Secret keys are never stored in the passkey credential; only a public key is registered.
 * - A per-entry random PRF salt (stored in localStorage) domain-separates PRF outputs.
 * - PRF output is run through HKDF-SHA256 before AES-256-GCM (see keyCrypto.ts).
 * - User verification (biometric/PIN) is required on every unlock.
 * - Requires a secure context (HTTPS or localhost).
 */

import { deriveAesKeyFromPrfMaterial } from "./keyCrypto";

/** PRF extension inputs (W3C WebAuthn PRF draft). */
interface PrfCreateExtension {
  eval?: { first: ArrayBuffer };
  evalByCredential?: Record<string, { first: ArrayBuffer }>;
}

interface PrfGetExtension {
  eval?: { first: ArrayBuffer };
}

interface PrfExtensionResults {
  enabled?: boolean;
  results?: { first?: ArrayBuffer };
}

export type PasskeyVaultErrorCode =
  | "INSECURE_CONTEXT"
  | "NOT_SUPPORTED"
  | "PRF_NOT_SUPPORTED"
  | "REGISTRATION_FAILED"
  | "AUTHENTICATION_FAILED"
  | "PRF_OUTPUT_MISSING"
  | "USER_CANCELLED"
  | "TIMEOUT"
  | "INVALID_STATE"
  | "UNKNOWN";

export class PasskeyVaultError extends Error {
  readonly code: PasskeyVaultErrorCode;
  readonly userMessage: string;

  constructor(code: PasskeyVaultErrorCode, userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "PasskeyVaultError";
    this.code = code;
    this.userMessage = userMessage;
    if (cause instanceof Error && cause.stack) {
      this.cause = cause;
    }
  }
}

export interface PasskeyVaultMeta {
  /** Base64url-encoded credential id. */
  credentialId: string;
  /** Base64url-encoded 32-byte PRF salt (public, acts as domain separator). */
  prfSalt: string;
  /** Relying party id used at registration (must match on unlock). */
  rpId: string;
  /** Base64url-encoded WebAuthn user handle. */
  userId: string;
}

const RP_NAME = "SPECTER";
const PRF_SALT_BYTES = 32;
const CHALLENGE_BYTES = 32;
const USER_ID_BYTES = 32;
const CREDENTIAL_TIMEOUT_MS = 120_000;

function assertSecureContext(): void {
  if (typeof window === "undefined" || !window.isSecureContext) {
    throw new PasskeyVaultError(
      "INSECURE_CONTEXT",
      "Passkeys require HTTPS or localhost. Open SPECTER on a secure connection.",
    );
  }
}

function assertWebAuthnAvailable(): void {
  if (typeof PublicKeyCredential === "undefined") {
    throw new PasskeyVaultError(
      "NOT_SUPPORTED",
      "This browser does not support passkeys. Use password encryption instead.",
    );
  }
}

/** Effective RP ID — must match between create() and get(). */
export function getVaultRpId(): string {
  const host = window.location.hostname;
  if (host === "127.0.0.1") return "localhost";
  return host;
}

export function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(b64url: string): ArrayBuffer {
  const padded =
    b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (b64url.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function randomBuffer(bytes: number): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(bytes)).buffer;
}

function mapDomException(err: unknown): PasskeyVaultError {
  if (err instanceof PasskeyVaultError) return err;
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError") {
      return new PasskeyVaultError(
        "USER_CANCELLED",
        "Passkey action was cancelled or not allowed. Try again.",
        err,
      );
    }
    if (err.name === "SecurityError") {
      return new PasskeyVaultError(
        "INSECURE_CONTEXT",
        "Passkey security check failed. Use HTTPS or localhost.",
        err,
      );
    }
    if (err.name === "InvalidStateError") {
      return new PasskeyVaultError(
        "INVALID_STATE",
        "A passkey for this vault may already exist on this device, or the authenticator is busy.",
        err,
      );
    }
    if (err.name === "TimeoutError") {
      return new PasskeyVaultError(
        "TIMEOUT",
        "Passkey request timed out. Try again.",
        err,
      );
    }
  }
  return new PasskeyVaultError(
    "UNKNOWN",
    err instanceof Error ? err.message : "Passkey operation failed.",
    err,
  );
}

function extractPrfOutput(
  extensionResults: AuthenticationExtensionsClientOutputs | undefined,
): ArrayBuffer {
  const prf = (extensionResults as { prf?: PrfExtensionResults } | undefined)?.prf;
  const first = prf?.results?.first;
  if (!first || first.byteLength < 32) {
    throw new PasskeyVaultError(
      "PRF_OUTPUT_MISSING",
      "Your passkey did not return a PRF value. Use a platform passkey (Touch ID, Face ID, Windows Hello) or save with a password.",
    );
  }
  return first;
}

/**
 * Probe whether PRF-based vault is available (secure context + WebAuthn + PRF capability).
 */
export async function isPasskeyVaultSupported(): Promise<boolean> {
  try {
    assertSecureContext();
    assertWebAuthnAvailable();
    const cap = PublicKeyCredential as typeof PublicKeyCredential & {
      getClientCapabilities?: () => Promise<Record<string, boolean>>;
    };
    if (typeof cap.getClientCapabilities === "function") {
      const caps = await cap.getClientCapabilities();
      if (caps["extension:prf"] === true) return true;
      if (caps["extension:prf"] === false) return false;
    }
    // No capability API — allow attempt (Chrome 118+, Safari 17.4+).
    return true;
  } catch {
    return false;
  }
}

export interface PasskeyRegistrationResult {
  meta: PasskeyVaultMeta;
  /** Derived AES key for immediate encryption (zero after use by caller). */
  aesKey: CryptoKey;
}

/**
 * Create a new passkey bound to this vault entry and derive the wrap key via PRF.
 */
export async function registerVaultPasskey(
  label: string,
  entryId: string,
): Promise<PasskeyRegistrationResult> {
  assertSecureContext();
  assertWebAuthnAvailable();

  const rpId = getVaultRpId();
  const prfSalt = randomBuffer(PRF_SALT_BYTES);
  const userId = randomBuffer(USER_ID_BYTES);
  const challenge = randomBuffer(CHALLENGE_BYTES);
  const displayName = label.trim() || "SPECTER Keys";
  const userName = `specter-vault-${entryId}`;

  const prfExtension: PrfCreateExtension = {
    eval: { first: prfSalt },
  };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: RP_NAME, id: rpId },
        user: {
          id: new Uint8Array(userId),
          name: userName,
          displayName,
        },
        challenge: new Uint8Array(challenge),
        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        timeout: CREDENTIAL_TIMEOUT_MS,
        attestation: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        extensions: {
          prf: prfExtension,
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw mapDomException(err);
  }

  if (!credential || !(credential.response instanceof AuthenticatorAttestationResponse)) {
    throw new PasskeyVaultError(
      "REGISTRATION_FAILED",
      "Passkey registration did not complete. Try again or use a password.",
    );
  }

  let prfOutput: ArrayBuffer;
  try {
    prfOutput = extractPrfOutput(credential.getClientExtensionResults());
  } catch {
    // Some authenticators only return PRF on assertion — perform immediate unlock.
    return authenticateVaultPasskeyAfterRegister({
      credentialId: toBase64Url(credential.rawId),
      prfSalt: toBase64Url(prfSalt),
      rpId,
      userId: toBase64Url(userId),
    });
  }

  const aesKey = await deriveAesKeyFromPrfMaterial(prfOutput);
  return {
    meta: {
      credentialId: toBase64Url(credential.rawId),
      prfSalt: toBase64Url(prfSalt),
      rpId,
      userId: toBase64Url(userId),
    },
    aesKey,
  };
}

async function authenticateVaultPasskeyAfterRegister(
  partial: Omit<PasskeyVaultMeta, never>,
): Promise<PasskeyRegistrationResult> {
  const prfOutput = await assertVaultPasskeyPrf(partial);
  const aesKey = await deriveAesKeyFromPrfMaterial(prfOutput);
  return { meta: partial, aesKey };
}

/**
 * Authenticate with passkey and return PRF output for key derivation.
 */
export async function assertVaultPasskeyPrf(meta: PasskeyVaultMeta): Promise<ArrayBuffer> {
  assertSecureContext();
  assertWebAuthnAvailable();

  const rpId = getVaultRpId();
  if (meta.rpId !== rpId) {
    throw new PasskeyVaultError(
      "INVALID_STATE",
      `This vault was saved on "${meta.rpId}" but you are on "${rpId}". Open the same site where you saved your keys.`,
    );
  }

  const credentialId = fromBase64Url(meta.credentialId);
  const prfSalt = fromBase64Url(meta.prfSalt);
  const challenge = randomBuffer(CHALLENGE_BYTES);

  const prfExtension: PrfGetExtension = {
    eval: { first: prfSalt },
  };

  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        rpId,
        challenge: new Uint8Array(challenge),
        timeout: CREDENTIAL_TIMEOUT_MS,
        userVerification: "required",
        allowCredentials: [
          {
            id: new Uint8Array(credentialId),
            type: "public-key",
          },
        ],
        extensions: {
          prf: prfExtension,
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    throw mapDomException(err);
  }

  if (!assertion) {
    throw new PasskeyVaultError(
      "AUTHENTICATION_FAILED",
      "Passkey authentication failed. Try again.",
    );
  }

  try {
    return extractPrfOutput(assertion.getClientExtensionResults());
  } catch (err) {
    if (err instanceof PasskeyVaultError) {
      throw new PasskeyVaultError(
        "PRF_NOT_SUPPORTED",
        "This passkey cannot derive vault keys (PRF not supported). Re-save with a password or a newer device passkey.",
        err,
      );
    }
    throw err;
  }
}

export async function deriveVaultAesKeyFromPasskey(meta: PasskeyVaultMeta): Promise<CryptoKey> {
  const prfOutput = await assertVaultPasskeyPrf(meta);
  return deriveAesKeyFromPrfMaterial(prfOutput);
}

/** Map vault/unlock errors to user-facing strings. */
export function formatVaultUnlockError(err: unknown): string {
  if (err instanceof PasskeyVaultError) return err.userMessage;
  if (err instanceof Error) {
    if (err.message.includes("decrypt") || err.message.includes("operation")) {
      return "Unlock failed — wrong password or corrupted vault data.";
    }
    return err.message;
  }
  return "Failed to unlock vault.";
}
