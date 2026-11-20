/** SIGNED_IN also fires on tab focus; that is not an identity change. */
export function authCacheAction(event: string, previous: string | null | undefined, next: string | null) {
  if (event === "SIGNED_OUT") return "clear";
  if (event === "SIGNED_IN") return previous === next ? "none" : "clear";
  if (event === "USER_UPDATED") return "refresh";
  return "none";
}
