// Allowlist shared by the browser transport and the same-origin relay.
// Two groups may use the relay, and nothing else:
//  1. access: sign in, keep the session and pass the access gate
//     (user, password state, profile, roles, worksite, membership);
//  2. Atividades page reads (weekly RPBC page and continuous Fiocruz page):
//     page configuration, weeks, get_activities_page, SAP overview/outside/
//     imports/rows, capacity, activity history, immediate-link options,
//     continuous rows/facets/counts/history.
//  Employee and overtime lists additionally require an explicit worksite filter
//  and the caller's bearer token in the relay. No writes are added.
// Writes, imports and admin paths are never allowed here. Every allowlisted RPC
// is STABLE in the database, so PostgREST runs it in a read-only transaction;
// do not add a VOLATILE function to RPC_READS.

export const ACCESS_RELAY_PREFIX = "/api/public/nexo-access";
/** Largest request body any allowlisted operation accepts. */
export const ACCESS_RELAY_MAX_BODY_BYTES = 256 * 1024;

export type AccessOperationKind =
  | "auth-password"
  | "auth-refresh"
  | "auth-user"
  | "auth-logout"
  | "rpc-password-state"
  | "read-gate"
  | "read-data"
  | "rpc-read";

export type AccessOperation = {
  kind: AccessOperationKind;
  method: "GET" | "POST";
  /** Repeating it cannot consume a token or change server state. */
  idempotent: boolean;
  /** Upstream table or RPC name for reads. */
  target?: string;
  maxBodyBytes: number;
  maxResponseBytes: number;
  /** Covers reading the request body, the upstream call and the upstream body. */
  timeoutMs: number;
  /** Prefer: count=exact may be forwarded (paginated continuous list). */
  allowCount: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_EQ = /^eq\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Plain columns of the same table only: no embedding of other tables, casts or aliases.
const COLUMNS = /^(\*|[a-z_]+(,[a-z_]+)*)$/;
const BOOL_EQ = /^eq\.(true|false)$/;
const ORDER_ITEM = "[a-z_]+\\.(asc|desc)(\\.nulls(first|last))?";
const ORDER = new RegExp(`^${ORDER_ITEM}(,${ORDER_ITEM}){0,3}$`);
const LIMIT = /^[1-9]\d{0,3}$/;
const OFFSET = /^\d{1,6}$/;
const WORD_IN = /^in\.\([a-z_]+(,[a-z_]+){0,9}\)$/;
// Continuous page: text search over the record's own JSON fields (client strips %_,().).
const CONT_ILIKE = "data->>[a-z_]{1,40}\\.ilike\\.%[^,()%_]{0,100}%";
const CONT_OR = new RegExp(`^\\(${CONT_ILIKE}(,${CONT_ILIKE}){0,9}\\)$`);
const CONT_FILTER = /^(in\.\(.{1,2000}\)|gte\.\d{4}-\d{2}-\d{2}|lte\.\d{4}-\d{2}-\d{2})$/;
const CONT_KEY = /^data->>[a-z_]{1,40}$/;

type TableRule = {
  params: Record<string, RegExp>;
  required: string[];
  /** Filters on the row's own JSON fields (continuous page only). */
  jsonFilters?: boolean;
  allowCount?: boolean;
  rangeFilters?: string[];
};

const GATE_TABLES: Record<string, TableRule> = {
  profiles: { params: { select: COLUMNS, id: UUID_EQ }, required: ["select", "id"] },
  user_roles: { params: { select: COLUMNS, user_id: UUID_EQ }, required: ["select", "user_id"] },
  worksites: { params: { select: COLUMNS, id: UUID_EQ, is_active: BOOL_EQ, order: ORDER }, required: ["select"] },
  worksite_memberships: {
    params: { select: COLUMNS, user_id: UUID_EQ, worksite_id: UUID_EQ },
    required: ["select", "user_id"],
  },
};

const DATA_TABLES: Record<string, TableRule> = {
  employees: {
    params: { select: COLUMNS, worksite_id: UUID_EQ, is_active: BOOL_EQ, deleted_at: /^is\.null$/, order: ORDER, offset: OFFSET, limit: LIMIT },
    required: ["select", "worksite_id"],
  },
  overtime_requests: {
    params: { select: COLUMNS, worksite_id: UUID_EQ, requester_user_id: UUID_EQ, overtime_date: /^(gte|lte)\.\d{4}-\d{2}-\d{2}$/, order: ORDER, offset: OFFSET, limit: LIMIT },
    required: ["select", "worksite_id"], rangeFilters: ["overtime_date"],
  },
  activity_page_configs: { params: { select: COLUMNS, worksite_id: UUID_EQ }, required: ["select", "worksite_id"] },
  weeks: {
    params: { select: COLUMNS, id: UUID_EQ, is_active: BOOL_EQ, lifecycle_status: WORD_IN, order: ORDER, limit: LIMIT },
    required: ["select"],
  },
  sap_confirmation_imports: {
    params: { select: COLUMNS, week_id: UUID_EQ, order: ORDER, limit: LIMIT },
    required: ["select", "week_id"],
  },
  sap_confirmation_rows: { params: { select: COLUMNS, import_id: UUID_EQ, order: ORDER, offset: OFFSET, limit: LIMIT }, required: ["select", "import_id"] },
  activity_history: {
    params: { select: COLUMNS, activity_id: UUID_EQ, order: ORDER, limit: LIMIT },
    required: ["select", "activity_id"],
  },
  // Immediate-link options inside the report modal: one week, immediates only.
  activities: {
    params: { select: COLUMNS, week_id: UUID_EQ, is_immediate: BOOL_EQ, order: ORDER },
    required: ["select", "week_id", "is_immediate"],
  },
  continuous_activities: {
    params: { select: COLUMNS, worksite_id: UUID_EQ, or: CONT_OR, order: ORDER, offset: OFFSET, limit: LIMIT },
    required: ["select", "worksite_id"],
    jsonFilters: true,
    allowCount: true,
  },
  continuous_activity_history: {
    params: { select: COLUMNS, worksite_id: UUID_EQ, record_id: UUID_EQ, order: ORDER, limit: LIMIT },
    required: ["select", "worksite_id", "record_id"],
  },
};

type BodyCheck = (body: Record<string, unknown>) => boolean;
const isUuid = (v: unknown) => typeof v === "string" && UUID.test(v);
const isInt = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isDateOrNull = (v: unknown) => v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
const hasExactly = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
const weekOnly: BodyCheck = (b) => hasExactly(b, ["p_week_id"]) && isUuid(b["p_week_id"]);
const continuousFacets: BodyCheck = (b) =>
  hasExactly(b, ["p_worksite", "p_search", "p_filters", "p_from", "p_to"]) &&
  isUuid(b["p_worksite"]) &&
  typeof b["p_search"] === "string" &&
  b["p_search"].length <= 200 &&
  isPlainObject(b["p_filters"]) &&
  isDateOrNull(b["p_from"]) &&
  isDateOrNull(b["p_to"]);

/** Read-only (STABLE) RPCs used by the Atividades page, with their exact argument shape. */
export const RPC_READS: Record<string, BodyCheck> = {
  get_activities_page: (b) =>
    hasExactly(b, ["p_week_id", "p_filters", "p_page", "p_page_size"]) &&
    isUuid(b["p_week_id"]) &&
    isPlainObject(b["p_filters"]) &&
    isInt(b["p_page"], 0, 10000) &&
    isInt(b["p_page_size"], 1, 5000),
  get_sap_confirmation_overview: weekOnly,
  get_sap_outside_schedule: weekOnly,
  get_activity_daily_capacity: weekOnly,
  continuous_activity_facets: continuousFacets,
  continuous_activity_status_counts: continuousFacets,
};

const ACCESS_LIMITS = { maxBodyBytes: 8 * 1024, maxResponseBytes: 512 * 1024, timeoutMs: 10_000, allowCount: false };
// Measured on the RPBC week: request bodies up to ~75 KB, responses up to ~0.9 MB
// per 500-row page, slowest recorded reads ~8 s. A day query may ask for 5000 rows.
const DATA_LIMITS = { maxBodyBytes: ACCESS_RELAY_MAX_BODY_BYTES, maxResponseBytes: 16 * 1024 * 1024, timeoutMs: 20_000 };

function queryMatches(search: string, rule: TableRule): boolean {
  const params = new URLSearchParams(search);
  const seen = new Map<string, number>();
  for (const [key, value] of params) {
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (value.length > 2100) return false;
    const fixed = rule.params[key];
    if (fixed) {
      if (!fixed.test(value)) return false;
      if (count > 1) {
        if (!rule.rangeFilters?.includes(key) || count > 2) return false;
        const values = params.getAll(key);
        if (values[0]?.split(".")[0] === values[1]?.split(".")[0]) return false;
      }
    } else if (rule.jsonFilters && CONT_KEY.test(key)) {
      if (count > 2 || !CONT_FILTER.test(value)) return false;
    } else return false;
  }
  return rule.required.every((key) => seen.has(key));
}

function op(kind: AccessOperationKind, method: "GET" | "POST", idempotent: boolean, extra: Partial<AccessOperation> = {}): AccessOperation {
  return { kind, method, idempotent, ...ACCESS_LIMITS, ...extra };
}

/** Returns the allowed operation for this exact method/path/query, or null. */
export function matchAccessOperation(method: string, pathname: string, search: string): AccessOperation | null {
  const m = method.toUpperCase();
  // Reject anything that is not a plain, already-normalised path (no encoding, dots or doubles).
  if (!/^\/[a-z0-9_/]+$/.test(pathname) || pathname.includes("//")) return null;
  if (search.length > 4000) return null;

  if (pathname === "/auth/v1/token" && m === "POST") {
    const params = new URLSearchParams(search);
    if ([...params.keys()].length !== 1) return null;
    const grant = params.get("grant_type");
    if (grant === "password") return op("auth-password", "POST", false);
    if (grant === "refresh_token") return op("auth-refresh", "POST", false);
    return null;
  }
  if (pathname === "/auth/v1/user" && m === "GET" && search === "") return op("auth-user", "GET", true);
  if (pathname === "/auth/v1/logout" && m === "POST") {
    const params = [...new URLSearchParams(search)];
    const ok = params.every(([k, v]) => k === "scope" && /^(global|local|others)$/.test(v)) && params.length <= 1;
    return ok ? op("auth-logout", "POST", false) : null;
  }

  const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(pathname)?.[1];
  if (rpc && m === "POST" && search === "") {
    if (rpc === "password_reset_state") return op("rpc-password-state", "POST", true, { target: rpc });
    if (Object.hasOwn(RPC_READS, rpc)) return op("rpc-read", "POST", true, { target: rpc, ...DATA_LIMITS });
    return null;
  }

  const table = /^\/rest\/v1\/([a-z_]+)$/.exec(pathname)?.[1];
  if (table && m === "GET") {
    if (Object.hasOwn(GATE_TABLES, table))
      return queryMatches(search, GATE_TABLES[table]!) ? op("read-gate", "GET", true, { target: table }) : null;
    if (Object.hasOwn(DATA_TABLES, table)) {
      const rule = DATA_TABLES[table]!;
      return queryMatches(search, rule)
        ? op("read-data", "GET", true, { target: table, ...DATA_LIMITS, allowCount: rule.allowCount === true })
        : null;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates the request body for an allowed operation (never logged). */
export function accessBodyAllowed(kind: AccessOperationKind, body: string, target?: string): boolean {
  if (kind === "auth-user" || kind === "read-gate" || kind === "read-data" || kind === "auth-logout")
    return body === "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (!isPlainObject(parsed)) return false;
  const keys = Object.keys(parsed);
  if (kind === "rpc-password-state") return keys.length === 0;
  if (kind === "rpc-read") {
    const check = target && Object.hasOwn(RPC_READS, target) ? RPC_READS[target] : undefined;
    return check ? check(parsed) : false;
  }
  if (kind === "auth-refresh")
    return (
      keys.length === 1 &&
      typeof parsed["refresh_token"] === "string" &&
      /^[A-Za-z0-9_-]{1,512}$/.test(parsed["refresh_token"])
    );
  // auth-password
  if (!keys.every((k) => k === "email" || k === "password" || k === "gotrue_meta_security")) return false;
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
