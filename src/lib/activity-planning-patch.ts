export const planningPatchFields = ["pbs","pt_number","pt_color","release_type","libra","scheduled_date"] as const;
export type PlanningPatchField = typeof planningPatchFields[number];
export type PlanningSnapshot = {id:string;version:number;pbs:string|null;pt_number:string|null;pt_color:string|null;release_type:string|null;scheduled_date:string|null;planning_data?:Record<string,unknown>|null};
const clean=(v:unknown)=>typeof v==="string" ? v.trim()||null : null;
export function planningSnapshotValues(row:PlanningSnapshot){
 return {pbs:clean(row.pbs),pt_number:clean(row.pt_number),pt_color:clean(row.pt_color),release_type:clean(row.release_type),libra:clean(row.planning_data?.LIBRA),scheduled_date:clean(row.scheduled_date)};
}
export function buildPlanningPatch(row:PlanningSnapshot,changes:Partial<Record<PlanningPatchField,string|null>>){
 const before=planningSnapshotValues(row),after={...before};const fields:PlanningPatchField[]=[];
 for(const field of planningPatchFields)if(Object.hasOwn(changes,field)&&clean(changes[field])!==before[field]){after[field]=clean(changes[field]);fields.push(field);}
 return {id:row.id,expectedVersion:row.version,fields,intentFields:planningPatchFields.filter(f=>Object.hasOwn(changes,f)),expectedValues:Object.fromEntries(fields.map(f=>[f,before[f]])),
 pbs:after.pbs,ptNumber:after.pt_number,ptColor:after.pt_color as "red"|"yellow"|"white"|null,
 releaseType:after.release_type as "PT"|"PTT"|"ATRE"|"OFICINAS"|null,libra:after.libra,scheduledDate:after.scheduled_date};
}
export function clearSavedPlanningDraft(drafts:Record<string,Partial<Record<PlanningPatchField,string>>>,patches:ReturnType<typeof buildPlanningPatch>[]){
 const next={...drafts};
 for(const patch of patches){const draft={...next[patch.id]};const sent={pbs:patch.pbs,pt_number:patch.ptNumber,pt_color:patch.ptColor,release_type:patch.releaseType,libra:patch.libra,scheduled_date:patch.scheduledDate};
 for(const f of patch.intentFields)if(Object.hasOwn(draft,f)&&clean(draft[f])===sent[f])delete draft[f];
 if(Object.keys(draft).length)next[patch.id]=draft;else delete next[patch.id];}
 return next;
}
