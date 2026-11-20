export type DirectoryProfile = { id: string; email: string; full_name: string; approval_status: string };
export type DirectoryMembership = { user_id: string; worksite_id: string; is_worksite_admin: boolean };
export function canReadDirectory(approved: boolean, global: boolean, roles: string[], localAdmin: boolean) {
  return approved && (global || roles.includes('admin') || localAdmin);
}
export function assembleDirectory(profiles: DirectoryProfile[], roles: { user_id: string; role: string }[],
 memberships: DirectoryMembership[], audit: { user_id: string; event: string; happened_at: string; actor_name: string | null }[],
 global: boolean, worksiteId: string) {
 const visibleMemberships = global ? memberships : memberships.filter(row => row.worksite_id === worksiteId);
 const visibleIds = new Set(visibleMemberships.map(row => row.user_id));
 const rolesByUser = new Map<string, string[]>(), membershipsByUser = new Map<string, DirectoryMembership[]>();
 for (const row of roles) rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row.role]);
 for (const row of visibleMemberships) membershipsByUser.set(row.user_id, [...(membershipsByUser.get(row.user_id) ?? []), row]);
 const auditByUser = new Map(audit.map(row => [row.user_id, row]));
 return profiles.filter(row => global || visibleIds.has(row.id)).map(row => ({
  id:row.id,email:row.email,full_name:row.full_name,approval_status:row.approval_status,
  roles: rolesByUser.get(row.id) ?? [], memberships: membershipsByUser.get(row.id) ?? [], resetAudit: auditByUser.get(row.id),
 }));
}
