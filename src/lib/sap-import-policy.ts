import {z} from 'zod';
const text=z.string().max(10000).nullable(),num=z.number().finite().nullable();
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
export const sapImportRowSchema=z.object({source_row_number:z.number().int().min(1),order_number:z.string().trim().min(1).max(10000),
 operation:text,suboperation:text,planning_code:text,work_center:text,description:text,actual_start_date:day,actual_end_date:day,
 system_status:text,normal_duration:num,planned_work:num,actual_work:num,user_status:text,operational_area:text,confirmation:z.string().trim().min(1).max(10000)}).strict();
export const sapImportSchema=z.object({requestId:z.string().uuid(),weekId:z.string().uuid(),fileName:z.string().trim().min(1).max(1024),rows:z.array(sapImportRowSchema).min(1).max(5000)}).strict()
 .refine(data=>new TextEncoder().encode(JSON.stringify(data)).byteLength<=8*1024*1024,'A importação SAP excede 8 MB de dados.');
export type SapImportInput=z.infer<typeof sapImportSchema>;
// A lost response is not a failed transaction. Retain the same requestId on retry.
export function sapImportUnconfirmedMessage(){return 'Não foi possível confirmar o envio SAP. Mantenha esta prévia aberta e tente novamente: esta mesma tentativa é protegida contra duplicação.';}
