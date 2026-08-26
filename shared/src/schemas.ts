import { z } from 'zod';
import { CHROME_LANGUAGE_LIST } from './languages.js';
import { isValidTimezone } from './timezones.js';

const timezoneSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => value === 'UTC' || value === 'GMT' || isValidTimezone(value), 'Invalid timezone');

export const roleSchema = z.enum(['admin', 'user']);

export const proxyTypeSchema = z.enum(['http', 'https', 'socks5']);

export const proxyTypeOrNoneSchema = z.enum(['http', 'https', 'socks5', 'none']);

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

export const accessKindSchema = z.enum(['session', 'folder']);

export const userGrantItemSchema = z.object({
  kind: accessKindSchema,
  targetId: z.string().min(1),
});

export const putUserGrantsSchema = z.object({
  grants: z.array(userGrantItemSchema),
});

export const putTargetGrantsSchema = z.object({
  userIds: z.array(z.string().min(1)),
});

export const createProxySchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: proxyTypeSchema,
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(200).optional().default(''),
  password: z.string().max(200).optional().default(''),
});

export const updateProxySchema = createProxySchema.partial();

/** Idle auto-stop timeout stored on each session. Unit is minutes; 0 disables. */
export const IDLE_TIMEOUT_MINUTES_MAX = 7 * 24 * 60;

export const idleTimeoutMinutesSchema = z.number().int().min(0).max(IDLE_TIMEOUT_MINUTES_MAX);

export const createSessionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional().default(''),
  groupId: z.string().min(1).nullable().optional(),
  proxyId: z.string().min(1).nullable().optional(),
  timezone: timezoneSchema.optional(),
  chromeLanguage: z.enum(CHROME_LANGUAGE_LIST).optional(),
  homeUrl: z.string().max(2000).optional(),
  idleTimeoutMinutes: idleTimeoutMinutesSchema.optional().default(0),
});

export const updateSessionSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  groupId: z.string().min(1).nullable().optional(),
  proxyId: z.string().min(1).nullable().optional(),
  timezone: timezoneSchema.optional(),
  chromeLanguage: z.enum(CHROME_LANGUAGE_LIST).optional(),
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
