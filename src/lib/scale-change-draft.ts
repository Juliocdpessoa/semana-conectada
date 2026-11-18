export type ScaleChangeDraft={version:1;ids:string[];transportIds:string[];weekdays:number[];search:string;startDate:string;endDate:string;entryTime:string;departureTime:string;orderNumber:string;service:string;observation:string};
export const scaleChangeDraftKey=(userId:string,worksiteId:string)=>"nexo:scale-change-draft:v1:"+userId+":"+worksiteId;
export function restoreScaleChangeDraft(raw:string|null,allowedIds:ReadonlySet<string>):ScaleChangeDraft|null{
 if(!raw||raw.length>100000)return null;
 try{const d=JSON.parse(raw);if(!d||d.version!==1||!Array.isArray(d.ids)||!Array.isArray(d.transportIds))return null;
 const string=(key:string)=>typeof d[key]==="string"?d[key]:"";
 const ids=[...new Set<string>(d.ids.filter((v:unknown):v is string=>typeof v==="string"&&allowedIds.has(v)))];
 const transportIds=[...new Set<string>(d.transportIds.filter((v:unknown):v is string=>typeof v==="string"&&ids.includes(v)))];
 const weekdays=Array.isArray(d.weekdays)?[...new Set<number>(d.weekdays.filter((v:unknown):v is number=>typeof v==="number"&&Number.isInteger(v)&&v>=0&&v<=6))]:[1,2,3,4,5];
 return {version:1,ids,transportIds,weekdays,search:string("search"),startDate:string("startDate"),endDate:string("endDate"),entryTime:string("entryTime"),departureTime:string("departureTime"),orderNumber:string("orderNumber"),service:string("service"),observation:string("observation")};
 }catch{return null;}
}
