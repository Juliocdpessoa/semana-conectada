import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("daily export shows the original request date/time beside requester for scale changes",()=>{
 const source=read("src/routes/_authenticated/hora-extra.tsx");
 const start=source.indexOf("paginatedTransportRows.map");
 const daily=source.slice(start,source.indexOf("/* ---------- My Requests",start));
 assert.match(daily,/"Solicitante",\s*"Lançado em",\s*"Transporte"/);
 assert.match(daily,/formatDateTime\(row.created_at\)/);
 assert.doesNotMatch(daily,/formatDateTime\(row.updated_at\)/);
});
test("scale list and Excel retain requester and add timestamp with aligned headers/widths/values",()=>{
 const view=read("src/routes/_authenticated/mudanca-de-escala.tsx");
 assert.match(view,/Solicitante<\/th>\s*<th[^>]*>Lançado em<\/th>/);
 assert.match(view,/formatDateTime\(row.created_at\)/);
 const source=read("src/lib/transport-export.ts");
 const headers=JSON.parse(source.match(/export const SCHEDULED_TRANSPORT_EXPORT_HEADERS = (\[[\s\S]*?\]) as const/)[1].replace(/,\s*\]/g,"]"));
 const widths=JSON.parse(source.match(/export const SCHEDULED_TRANSPORT_EXPORT_WIDTHS = (\[[\s\S]*?\]) as const/)[1].replace(/,\s*\]/g,"]"));
 const body=source.slice(source.indexOf("export function mapScheduledTransportExportRow"),source.indexOf("export function mapLogisticsScheduledTransportExportRow"));
 const values=body.match(/return (\[[\s\S]*?\]);/)[1];
 const fixture={sample:{requester_name:"Solicitante",created_at:"2026-10-30T13:15:00Z",updated_at:"2026-11-01T00:00:00Z",needs_transport:true,status:"scheduled"}};
 const map=new Function("group","formatDate","formatDateTime","fullAddress","formatScheduledStatus","const row=group.sample;return "+values);
 const result=map(fixture,()=>"",value=>"DATA:"+value,()=>"",()=>"Programado");
 assert.equal(headers.length,widths.length);assert.equal(result.length,headers.length);
 const index=headers.indexOf("Lançado em");assert.equal(headers[index-1],"Solicitante");
 assert.equal(result[index],"DATA:2026-10-30T13:15:00Z");
 assert.equal(result[index-1],"Solicitante");
});
