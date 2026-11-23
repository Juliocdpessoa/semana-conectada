import {accessDiagnosticSchema,type AccessDiagnosticInput} from './access-diagnostic-schema';
import {telemetryPost} from './telemetry-http';
export async function diagnosticHttp(request:Request,store:(data:AccessDiagnosticInput,bearer:string|null,signal:AbortSignal)=>Promise<{accepted:boolean}>){
 return telemetryPost(request,{schema:accessDiagnosticSchema,maxBytes:8192},store);
}
