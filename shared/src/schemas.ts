import { z } from 'zod';
import { GPU_PROFILE_IDS } from './gpuProfiles.js';
import { GEO_PERMISSIONS } from './geo.js';
import { FONT_PROFILES } from './fontProfiles.js';
import { WEBRTC_MODES } from './webrtc.js';
import { CHROME_LANGUAGE_LIST } from './languages.js';
import { isValidTimezone } from './timezones.js';
import { PROXY_TYPES, SS_METHODS } from './proxy.js';

const timezoneSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => value === 'UTC' || value === 'GMT' || isValidTimezone(value), 'Invalid timezone');

export const roleSchema = z.enum(['admin', 'user']);

export const proxyTypeSchema = z.enum(PROXY_TYPES);

export const proxyTypeOrNoneSchema = z.union([proxyTypeSchema, z.literal('none')]);

export const proxyExtraSchema = z.object({
  sni: z.string().max(255).optional().default(''),
  insecure: z.boolean().optional().default(false),
  method: z.string().max(64).optional().default('aes-256-gcm'),
  plugin: z.string().max(80).optional().default(''),
  pluginOpts: z.string().max(500).optional().default(''),
  flow: z.string().max(64).optional().default(''),
  network: z.enum(['tcp', 'ws']).optional().default('tcp'),
  wsPath: z.string().max(500).optional().default(''),
  wsHost: z.string().max(255).optional().default(''),
  security: z.enum(['none', 'tls', 'reality']).optional().default('tls'),
  fingerprint: z.string().max(64).optional().default(''),
  publicKey: z.string().max(200).optional().default(''),
  shortId: z.string().max(32).optional().default(''),
  alpn: z.string().max(64).optional().default(''),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Username must be alphanumeric'),
  password: z.string().min(4).max(200),
  role: roleSchema.default('user'),
});

export const updateUserSchema = z.object({
  password: z.string().min(4).max(200).optional(),
  role: roleSchema.optional(),
  disabled: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(4).max(200),
});

export const accessKindSchema = z.enum(['session', 'folder']);

export const userGrantItemSchema = z.object({
  kind: accessKindSchema,
  targetId: z.string().min(1),
  allowNotepad: z.boolean().optional().default(false),
});

export const putUserGrantsSchema = z.object({
  grants: z.array(userGrantItemSchema),
});

export const putTargetGrantsSchema = z.object({
  userIds: z.array(z.string().min(1)),
  notepadUserIds: z.array(z.string().min(1)).optional().default([]),
});

export const proxyFieldsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: proxyTypeSchema,
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(200).optional().default(''),
  password: z.string().max(2048).optional().default(''),
  extra: proxyExtraSchema.optional(),
  viaProxyId: z.string().min(1).nullable().optional(),
});

export const createProxySchema = proxyFieldsSchema.superRefine((value, ctx) => {
  if ((value.type === 'anytls' || value.type === 'ss' || value.type === 'vless') && !value.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: value.type === 'vless' ? 'UUID is required' : 'Password is required',
      path: ['password'],
    });
  }
  if (value.type === 'ss') {
    const method = value.extra?.method || 'aes-256-gcm';
    if (!(SS_METHODS as readonly string[]).includes(method) && method !== 'none') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unsupported Shadowsocks method',
        path: ['extra', 'method'],
      });
    }
  }
  if (value.type === 'vless' && value.extra?.security === 'reality' && !value.extra.publicKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Reality public key is required',
      path: ['extra', 'publicKey'],
    });
  }
});

export const updateProxySchema = proxyFieldsSchema.partial();

/** Idle auto-stop timeout stored on each session. Unit is minutes; 0 disables. */
export const IDLE_TIMEOUT_MINUTES_MAX = 7 * 24 * 60;

export const idleTimeoutMinutesSchema = z.number().int().min(0).max(IDLE_TIMEOUT_MINUTES_MAX);

export const webrtcModeSchema = z.enum(WEBRTC_MODES);

export const fontProfileSchema = z.enum(FONT_PROFILES);

export const geoSchema = z.object({
  permission: z.enum(GEO_PERMISSIONS).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracy: z.number().int().min(10).max(5000).optional(),
});

export const mediaDevicesSchema = z.object({
  audioInput: z.string().trim().max(80).optional(),
  audioOutput: z.string().trim().max(80).optional(),
  videoInput: z.string().trim().max(80).optional(),
});

export const notepadSchema = z.string();

export const putNotepadSchema = z.object({
  notepad: notepadSchema,
});

export const fingerprintFieldsSchema = z.object({
  gpuProfile: z.enum(GPU_PROFILE_IDS).optional(),
  webrtcMode: webrtcModeSchema.optional(),
  deviceName: z.string().trim().max(32).optional(),
  mediaDevices: mediaDevicesSchema.optional(),
  geo: geoSchema.optional(),
  fontProfile: fontProfileSchema.optional(),
});

const sessionFingerprintFields = {
  gpuProfile: z.enum(GPU_PROFILE_IDS).optional(),
  webrtcMode: webrtcModeSchema.optional(),
  deviceName: z.string().trim().max(32).optional(),
  mediaDevices: mediaDevicesSchema.optional(),
  geo: geoSchema.optional(),
  fontProfile: fontProfileSchema.optional(),
  fingerprint: fingerprintFieldsSchema.optional(),
};

export function pickSessionFingerprint(input: {
  gpuProfile?: string;
  webrtcMode?: z.infer<typeof webrtcModeSchema>;
  deviceName?: string;
  mediaDevices?: z.infer<typeof mediaDevicesSchema>;
  geo?: z.infer<typeof geoSchema>;
  fontProfile?: z.infer<typeof fontProfileSchema>;
  fingerprint?: z.infer<typeof fingerprintFieldsSchema>;
}) {
  const nested = input.fingerprint || {};
  return {
    gpuProfile: input.gpuProfile ?? nested.gpuProfile,
    webrtcMode: input.webrtcMode ?? nested.webrtcMode,
    deviceName: input.deviceName ?? nested.deviceName,
    mediaDevices: input.mediaDevices ?? nested.mediaDevices,
    geo: input.geo ?? nested.geo,
    fontProfile: input.fontProfile ?? nested.fontProfile,
  };
}

export const createSessionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional().default(''),
  notepad: notepadSchema.optional().default(''),
  groupId: z.string().min(1).nullable().optional(),
  proxyId: z.string().min(1).nullable().optional(),
  timezone: timezoneSchema.optional(),
  chromeLanguage: z.enum(CHROME_LANGUAGE_LIST).optional(),
  ...sessionFingerprintFields,
  homeUrl: z.string().max(2000).optional(),
  idleTimeoutMinutes: idleTimeoutMinutesSchema.optional().default(0),
});

export const updateSessionSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  notepad: notepadSchema.optional(),
  groupId: z.string().min(1).nullable().optional(),
  proxyId: z.string().min(1).nullable().optional(),
  timezone: timezoneSchema.optional(),
  chromeLanguage: z.enum(CHROME_LANGUAGE_LIST).optional(),
  ...sessionFingerprintFields,
  homeUrl: z.string().max(2000).optional(),
  idleTimeoutMinutes: idleTimeoutMinutesSchema.optional(),
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().min(1).nullable().optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export const startSessionSchema = z.object({
  url: z.string().max(2000).optional(),
});

export const createWindowSchema = z.object({
  url: z.string().max(2000).optional(),
  takeover: z.boolean().optional(),
});

export const displaySchema = z.object({
  width: z.number().int().min(40).max(10000),
  height: z.number().int().min(40).max(10000),
});

export const clipboardSchema = z.object({
  text: z.string().max(1024 * 1024),
});

export const TYPE_TEXT_MAX = 8192;

export const typeTextSchema = z.object({
  text: z.string().max(TYPE_TEXT_MAX),
});
