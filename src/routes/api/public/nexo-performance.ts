import {createFileRoute} from '@tanstack/react-router';
import {performanceHttp} from '@/lib/performance-http';
export const Route=createFileRoute('/api/public/nexo-performance')({server:{handlers:{POST:async({request})=>{
 const {storePerformanceSample}=await import('@/lib/performance-record.server');
 return performanceHttp(request,storePerformanceSample);
}}}});
