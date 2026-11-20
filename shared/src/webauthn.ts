import { z } from 'zod';
import type { WebAuthnConfig, WebAuthnOptions, WebAuthnProvider } from './types.js';

export const WEBAUTHN_PROTOCOLS = ['ctap2', 'u2f'] as const;
export const WEBAUTHN_CTAP2_VERSIONS = ['ctap2_0', 'ctap2_1', 'ctap2_2'] as const;
export const WEBAUTHN_TRANSPORTS = ['internal', 'usb', 'nfc', 'ble', 'cable'] as const;
export const WEBAUTHN_PROVIDERS = ['google', 'apple', 'windows', '1password', 'yubikey'] as const;
export const DEFAULT_WEBAUTHN_PROVIDER: WebAuthnProvider = 'google';

export const WEBAUTHN_PROVIDER_LABELS: Record<WebAuthnProvider, string> = {
  google: 'Google 密码管理器',
  apple: 'Apple iCloud 钥匙串',
  windows: 'Windows Hello',
  '1password': '1Password',
  yubikey: 'YubiKey 5 系列',
};

const BASE_WEBAUTHN_OPTIONS: WebAuthnOptions = {
  protocol: 'ctap2',
  ctap2Version: 'ctap2_1',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
  hasLargeBlob: false,
  hasCredBlob: false,
  hasMinPinLength: false,
  hasPrf: false,
  defaultBackupEligibility: true,
  defaultBackupState: true,
};

export function webauthnOptionsForProvider(provider: WebAuthnProvider): WebAuthnOptions {
  switch (provider) {
    case 'windows':
      return {
        ...BASE_WEBAUTHN_OPTIONS,
        transport: 'internal',
        defaultBackupEligibility: false,
        defaultBackupState: false,
      };
    case 'yubikey':
      return {
        ...BASE_WEBAUTHN_OPTIONS,
        transport: 'usb',
        defaultBackupEligibility: false,
        defaultBackupState: false,
      };
    case 'apple':
    case '1password':
    case 'google':
    default:
      return { ...BASE_WEBAUTHN_OPTIONS };
  }
}

export const DEFAULT_WEBAUTHN_OPTIONS: WebAuthnOptions = webauthnOptionsForProvider(DEFAULT_WEBAUTHN_PROVIDER);

export function coerceWebAuthnProvider(input: unknown): WebAuthnProvider {
  return typeof input === 'string' && (WEBAUTHN_PROVIDERS as readonly string[]).includes(input)
    ? (input as WebAuthnProvider)
    : DEFAULT_WEBAUTHN_PROVIDER;
}

export const webauthnOptionsSchema = z.object({
  protocol: z.enum(WEBAUTHN_PROTOCOLS).optional(),
  ctap2Version: z.enum(WEBAUTHN_CTAP2_VERSIONS).optional(),
  transport: z.enum(WEBAUTHN_TRANSPORTS).optional(),
  hasResidentKey: z.boolean().optional(),
  hasUserVerification: z.boolean().optional(),
  isUserVerified: z.boolean().optional(),
  automaticPresenceSimulation: z.boolean().optional(),
  hasLargeBlob: z.boolean().optional(),
  hasCredBlob: z.boolean().optional(),
  hasMinPinLength: z.boolean().optional(),
  hasPrf: z.boolean().optional(),
  defaultBackupEligibility: z.boolean().optional(),
  defaultBackupState: z.boolean().optional(),
});

export const putWebAuthnSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(WEBAUTHN_PROVIDERS).optional(),
  options: webauthnOptionsSchema.optional(),
});

const base64Schema = z
  .string()
  .trim()
  .max(1024 * 1024)
  .regex(/^[A-Za-z0-9+/_-]*={0,2}$/, 'must be base64');

/** Accepts a CDP `WebAuthn.Credential` as returned by `getCredentials`, plus nya fields. */
export const importPasskeySchema = z.object({
  rpId: z.string().trim().min(1).max(253),
  credentialId: base64Schema.min(1),
  privateKey: base64Schema.min(1),
  isResidentCredential: z.boolean().optional(),
  userHandle: base64Schema.nullable().optional(),
  userName: z.string().max(1024).optional(),
  userDisplayName: z.string().max(1024).optional(),
  signCount: z.number().int().min(-1).max(0xffffffff).optional(),
  backupEligibility: z.boolean().nullable().optional(),
  backupState: z.boolean().nullable().optional(),
  largeBlob: base64Schema.nullable().optional(),
  label: z.string().max(200).optional(),
  origin: z.string().max(2000).optional(),
});

export const patchPasskeySchema = z.object({
  label: z.string().max(200).optional(),
  signCount: z.number().int().min(-1).max(0xffffffff).optional(),
});

export function normalizeWebAuthnOptions(
  input: unknown,
  provider: WebAuthnProvider = DEFAULT_WEBAUTHN_PROVIDER,
): WebAuthnOptions {
  const parsed = webauthnOptionsSchema.safeParse(input && typeof input === 'object' ? input : {});
  return { ...webauthnOptionsForProvider(provider), ...(parsed.success ? stripUndefined(parsed.data) : {}) };
}

export function normalizeWebAuthnConfig(input: unknown): WebAuthnConfig {
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const provider = coerceWebAuthnProvider(obj.provider);
  return { enabled: obj.enabled === true, provider, options: normalizeWebAuthnOptions(obj.options, provider) };
}

/** Combinations Chrome's `addVirtualAuthenticator` rejects; null when the options are usable. */
export function webauthnOptionsProblem(o: WebAuthnOptions): string | null {
  if (o.protocol === 'u2f') {
    if (!['usb', 'ble', 'nfc'].includes(o.transport)) return 'U2F only supports the usb, ble and nfc transports';
    return null;
  }
  // CDP cannot export or restore the per-credential PRF (hmac-secret) key or credBlob, so
  // they would change every time a tab's authenticator is rebuilt from the database.
  if (o.hasPrf || o.hasCredBlob) return 'PRF and credBlob are not supported: their secrets cannot be exported';
  if (o.hasLargeBlob && !o.hasResidentKey) return 'Large blob requires resident key support';
  if ((o.hasLargeBlob || o.hasMinPinLength) && o.ctap2Version === 'ctap2_0') {
    return 'largeBlob and minPinLength require ctap2_1 or later';
  }
  return null;
}

export function defaultWebAuthnConfig(): WebAuthnConfig {
  return {
    enabled: false,
    provider: DEFAULT_WEBAUTHN_PROVIDER,
    options: webauthnOptionsForProvider(DEFAULT_WEBAUTHN_PROVIDER),
  };
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
