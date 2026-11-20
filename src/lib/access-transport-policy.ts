// Allowlist shared by the browser transport and the same-origin relay.
// Only the requests needed to sign in, keep the session and pass the access gate
// (user, password state, profile, roles, worksite, membership) may use the relay.

export const ACCESS_RELAY_PREFIX = "/api/public/nexo-access";
export const ACCESS_RELAY_MAX_BODY_BYTES = 8 * 1024;

export type AccessOperationKind =
  | "auth-password"
  | "auth-refresh"
  | "auth-user"
  | "auth-logout"
  | "rpc-password-state"
  | "read-gate";

export type AccessOperation = {
  kind: AccessOperationKind;
  method: "GET" | "POST";
  /** Repeating it cannot consume a token or change server state. */
  idempotent: boolean;
};

const UUID_EQ = /^eq\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = /^[a-z_]+(,[a-z_]+)*$/; // plain columns only: no embedding of other tables
const BOOL_EQ = /^eq\.(true|false)$/;
const ORDER = /^[a-z_]+\.(asc|desc)$/;

type ParamRule = Record<string, RegExp>;
const GATE_TABLES: Record<string, ParamRule> = {
  profiles: { select: COLUMNS, id: UUID_EQ },
  user_roles: { select: COLUMNS, user_id: UUID_EQ },
  worksites: { select: COLUMNS, id: UUID_EQ, is_active: BOOL_EQ, order: ORDER },
  worksite_memberships: { select: COLUMNS, user_id: UUID_EQ, worksite_id: UUID_EQ },
};

function queryMatches(search: string, rules: ParamRule, required: string[] = []): boolean {
  const params = new URLSearchParams(search);
  const seen = new Set<string>();
  for (const [key, value] of params) {
    const rule = rules[key];
    if (!rule || seen.has(key) || value.length > 300 || !rule.test(value)) return false;
    seen.add(key);
  }
  return required.every((key) => seen.has(key));
}

/** Returns the allowed operation for this exact method/path/query, or null. */
export function matchAccessOperation(
  method: string,
  pathname: string,
  search: string,
): AccessOperation | null {
  const m = method.toUpperCase();
  // Reject anything that is not a plain, already-normalised path (no encoding, dots or doubles).
  if (!/^\/[a-z0-9_/]+$/.test(pathname) || pathname.includes("//")) return null;
  if (search.length > 600) return null;

  if (pathname === "/auth/v1/token" && m === "POST") {
    const params = new URLSearchParams(search);
    if ([...params.keys()].length !== 1) return null;
    const grant = params.get("grant_type");
    if (grant === "password") return { kind: "auth-password", method: "POST", idempotent: false };
    if (grant === "refresh_token") return { kind: "auth-refresh", method: "POST", idempotent: false };
    return null;
  }
  if (pathname === "/auth/v1/user" && m === "GET" && search === "")
    return { kind: "auth-user", method: "GET", idempotent: true };
  if (pathname === "/auth/v1/logout" && m === "POST") {
    return queryMatches(search, { scope: /^(global|local|others)$/ })
      ? { kind: "auth-logout", method: "POST", idempotent: false }
      : null;
  }
  if (pathname === "/rest/v1/rpc/password_reset_state" && m === "POST" && search === "")
    return { kind: "rpc-password-state", method: "POST", idempotent: true };

  const table = /^\/rest\/v1\/([a-z_]+)$/.exec(pathname)?.[1];
  if (table && m === "GET" && Object.hasOwn(GATE_TABLES, table)) {
    return queryMatches(search, GATE_TABLES[table]!, ["select"])
      ? { kind: "read-gate", method: "GET", idempotent: true }
      : null;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates the request body for an allowed operation (never logged). */
export function accessBodyAllowed(kind: AccessOperationKind, body: string): boolean {
  if (kind === "auth-user" || kind === "read-gate" || kind === "auth-logout") return body === "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (!isPlainObject(parsed)) return false;
  const keys = Object.keys(parsed);
  if (kind === "rpc-password-state") return keys.length === 0;
  if (kind === "auth-refresh")
    return (
      keys.length === 1 &&
      typeof parsed["refresh_token"] === "string" &&
      /^[A-Za-z0-9_-]{1,512}$/.test(parsed["refresh_token"])
    );
  // auth-password
  if (!keys.every((k) => k === "email" || k === "password" || k === "gotrue_meta_security"))
    return false;
  const { email, password, gotrue_meta_security: meta } = parsed;
  if (typeof email !== "string" || email.length < 3 || email.length > 320) return false;
  if (typeof password !== "string" || password.length < 1 || password.length > 1024) return false;
  if (meta === undefined) return true;
  return (
    isPlainObject(meta) &&
    Object.keys(meta).every((k) => k === "captcha_token") &&
    (meta["captcha_token"] === undefined ||
      (typeof meta["captcha_token"] === "string" && meta["captcha_token"].length <= 4096))
  );
}
