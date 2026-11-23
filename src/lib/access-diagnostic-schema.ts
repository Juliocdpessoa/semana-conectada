import {z} from 'zod';
import {REALTIME_REASONS} from './realtime-diagnostics';
export const accessDiagnosticSchema=z.object({
 id:z.string().uuid(),clientId:z.string().uuid(),
 stage:z.enum(['session','identity','password','profile','roles','worksite','membership','runtime','realtime']),reason:z.enum(REALTIME_REASONS).optional(),
 category:z.enum(['network','timeout','auth','server','missing','runtime']),route:z.enum(['login','password','home','activities','other']),
 build:z.enum(['access-diag-20261119-v1','access-diag-20261120-v2']),attempts:z.number().int().min(1).max(2),elapsedMs:z.number().int().min(0).max(60000),
 frames:z.array(z.string().max(150).regex(/^\/assets\/[a-zA-Z0-9_.-]+\.js:\d+:\d+$/)).max(4),
 occurredAt:z.string().datetime().optional(),release:z.string().regex(/^(?:[a-f0-9]{40}|unavailable)$/).optional(),
 visibility:z.enum(['visible','hidden','unknown']).optional(),online:z.boolean().optional(),
}).strict();
export type AccessDiagnosticInput=z.infer<typeof accessDiagnosticSchema>;
