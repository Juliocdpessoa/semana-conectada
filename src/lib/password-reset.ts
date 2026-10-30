import { z } from "zod";

export const TEMPORARY_PASSWORD = "123456";
export const newPasswordSchema = z.string().min(8, "Mínimo 8 caracteres").max(72)
  .refine((value) => value !== TEMPORARY_PASSWORD, "Escolha uma senha diferente da temporária.");
export type PasswordResetState = {
  required: boolean; allowed: boolean; can_change: boolean; expired: boolean; reset_id: string | null;
};

type AccessUser = { id: string; email: string; approval_status: string; roles: string[];
  memberships: Array<{ worksite_id: string; is_worksite_admin: boolean }> };

export function canResetPassword(actor: AccessUser, target: AccessUser, worksiteId: string) {
  if (actor.approval_status !== "approved" || target.approval_status !== "approved" || actor.id === target.id) return false;
  if (actor.email.trim().toLowerCase() === "julio.pessoa@normatel.com.br") return true;
  // A local administrator must not take over a global or multi-worksite account.
  if (target.roles.includes("admin") || target.memberships.some((m) => m.worksite_id !== worksiteId)) return false;
  return actor.memberships.some((m) => m.worksite_id === worksiteId && m.is_worksite_admin)
    && target.memberships.some((m) => m.worksite_id === worksiteId);
}
