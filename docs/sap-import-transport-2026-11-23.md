# Activities SAP upload: direct-fetch failure

The reported failure occurs after Confirmar registros, not while parsing the workbook. The UI still called `import_sap_confirmations` directly against the backend domain, unlike the protected same-origin reads/access flow. This established an unprotected transport path; the exact external reason for this user's Failed to fetch is not independently proven.

The new fixed server function validates only the existing official SAP fields, week, filename and an attempt UUID. It uses caller authentication/password checks and the caller-bound client, not a service client or generic write proxy. Existing SAP import permission, worksite, original importer, append-only history and calculations remain unchanged.

A narrow database wrapper records a receipt atomically with the canonical import. It validates caller approval, SAP permission, password access and worksite before looking up any receipt. Same actor/attempt/payload returns the existing import result; a changed payload or a removed load raises PT409. A nonblocking transaction advisory lock prevents concurrent repeats. Receipts are private, contain a SHA-256 payload fingerprint/result (not a second copy of the workbook), and are removed on week/account deletion.

The preview retains its attempt ID and target week during an uncertain result; no automatic write retry is added. Changed selected weeks cannot silently receive an older preview. A later list-refresh error is not reported as import failure after a confirmed save.

A migration rehearsal created one synthetic week/SAP row inside a transaction, called the wrapper twice, confirmed one import/one row, rejected changed payload/anonymous execution and checked receipt-table privileges. The complete transaction was rolled back; no real task/week/load was used or changed. No user workbook was uploaded by this agent.

The migration must be applied before publishing the UI/server function. Existing loads are not converted or reimported. A user must reload the new application version before the button uses the new path. This change does not claim that every direct mutation elsewhere in the app is now independent of backend-domain connectivity.

Validation: 256 Node regression tests passed; type checking passed. The receipt migration was applied after the rolled-back replay/authorization test. Verification found zero persistent synthetic weeks and zero import receipts before any real user submission. The production build is checked before synchronization/publication. No existing SAP row or task was edited by the fix.
