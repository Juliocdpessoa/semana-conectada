import {createFileRoute} from '@tanstack/react-router';
import {diagnosticHttp} from '@/lib/diagnostic-http';
export const Route=createFileRoute('/api/public/nexo-diagnostics')({server:{handlers:{POST:async({request})=>{
 const {storeAccessDiagnostic}=await import('@/lib/access-diagnostic-record.server');
 return diagnosticHttp(request,storeAccessDiagnostic);
}}}});
