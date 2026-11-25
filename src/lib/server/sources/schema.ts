import { z } from 'zod';

export const configSchema = z.object({
  headers: z.record(z.string(), z.string()).optional(),
  username: z.string().max(200).optional(),
  password: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  maxDepth: z.number().int().min(0).max(50).optional(),
  maxFiles: z.number().int().min(1).max(1_000_000).optional(),
  maxPages: z.number().int().min(1).max(100_000).optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
  delayMs: z.number().int().min(0).max(60_000).optional(),
  include: z.array(z.string().max(200)).max(50).optional(),
  exclude: z.array(z.string().max(200)).max(50).optional(),
  renderJs: z.boolean().optional(),
  wideScope: z.boolean().optional(),
  path: z.string().max(2000).optional(),
});
