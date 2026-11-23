import {z} from 'zod';
import {telemetryPost} from './telemetry-http';
export const performanceSampleSchema=z.object({operation:z.enum(['activities_list','activities_filter','realtime_connect','realtime_disconnect','realtime_recovery']),durationMs:z.number().int().min(0).max(86400000),success:z.boolean()}).strict();
export type PerformanceSampleInput=z.infer<typeof performanceSampleSchema>;
export function performanceHttp(request:Request,store:(data:PerformanceSampleInput,bearer:string|null,signal:AbortSignal)=>Promise<{accepted:boolean}>){
 return telemetryPost(request,{schema:performanceSampleSchema,maxBytes:4096,requireBearer:true},store);
}
