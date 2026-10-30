import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  collectArchiveDownload,
  archiveBatchChunks,
  ARCHIVE_PAGE_SIZE,
} from "../src/lib/operational-archive-download.ts";
const archive = {
  id: "archive",
  cutoff_date: "2026-09-28",
  prepared_at: "2026-10-30T12:19:26Z",
  overtime_count: 4641,
  scale_change_count: 1640,
};
const fixtures = Array.from({ length: 6281 }, (_, i) => ({
  id: String(i + 1),
  record_date: "2026-09-01",
  source_type: i < 4641 ? "overtime" : "scale_change",
  payload: {
    requested_by: "Teste",
    status: "pending",
    description: "Todos os campos",
    nested: { keep: true },
  },
}));
const loader = async (offset) => ({
  archive,
  rows: fixtures.slice(offset, offset + ARCHIVE_PAGE_SIZE),
  nextOffset: offset + ARCHIVE_PAGE_SIZE < fixtures.length ? offset + ARCHIVE_PAGE_SIZE : null,
});
test("6281 rows download in 32 bounded calls, preserving fields and pending records", async () => {
  const calls = [],
    progress = [];
  const rows = await collectArchiveDownload(
    archive,
    async (offset) => {
      calls.push(offset);
      return loader(offset);
    },
    (n, total) => progress.push([n, total]),
  );
  assert.equal(calls.length, 32);
  assert.equal(calls.at(-1), 6200);
  assert.deepEqual(rows, fixtures);
  assert.deepEqual(progress.at(-1), [6281, 6281]);
  assert.equal(rows.filter((r) => r.source_type === "overtime").length, 4641);
  assert.equal(rows.filter((r) => r.source_type === "scale_change").length, 1640);
});
test("1554 batch IDs are split in groups of at most 50 without truncation", () => {
  const ids = Array.from({ length: 1554 }, (_, i) => String(i));
  const chunks = archiveBatchChunks([...ids, ids[0]]);
  assert.equal(chunks.length, 32);
  assert.ok(chunks.every((c) => c.length <= 50));
  assert.deepEqual(chunks.flat(), ids);
});
test("incomplete, repeated, changed and failed pages reject the entire export", async () => {
  const small = { ...archive, overtime_count: 2, scale_change_count: 0 };
  const row = fixtures[0];
  await assert.rejects(
    () =>
      collectArchiveDownload(small, async () => ({
        archive: small,
        rows: [row],
        nextOffset: null,
      })),
    /incompleto/,
  );
  await assert.rejects(
    () =>
      collectArchiveDownload(small, async () => ({
        archive: small,
        rows: [row, row],
        nextOffset: null,
      })),
    /repetido/,
  );
  await assert.rejects(
    () =>
      collectArchiveDownload(small, async () => ({
        archive: { ...small, prepared_at: "changed" },
        rows: [],
        nextOffset: null,
      })),
    /mudou/,
  );
  await assert.rejects(
    () =>
      collectArchiveDownload(archive, async (offset) => {
        if (offset > 0) throw Error("520");
        return loader(offset);
      }),
    /520/,
  );
  await assert.rejects(
    () =>
      collectArchiveDownload(small, async () => ({
        archive: small,
        rows: [row, { ...row, id: "2", source_type: "scale_change" }],
        nextOffset: null,
      })),
    /quantidades/,
  );
});
test("read-only server enforces admin/worksite scope, stable pages and bounded batch enrichment", () => {
  const source = readFileSync(
    new URL("../src/lib/operational-archive.functions.ts", import.meta.url),
    "utf8",
  );
  const handler = source.slice(
    source.indexOf("export const loadOperationalArchivePage"),
    source.indexOf("export const finalizeOperationalArchive"),
  );
  assert.match(handler, /archiveAccess\(context.supabase, context.userId\)/);
  assert.match(handler, /\.eq\("worksite_id", access.worksiteId\)/);
  assert.match(handler, /\.order\("id", \{ ascending: true \}\)/);
  assert.match(handler, /data.offset \+ ARCHIVE_PAGE_SIZE - 1/);
  assert.match(handler, /archiveBatchChunks\(batchIds\)/);
  assert.doesNotMatch(handler, /\.in\("id", batchIds\)|\.delete\(|\.update\(/);
});
test("download button matches Finalizar and partial downloads never unlock finalization", () => {
  const view = readFileSync(
    new URL("../src/routes/_authenticated/hora-extra.tsx", import.meta.url),
    "utf8",
  );
  const download = view.slice(
    view.indexOf("async function handleDownload"),
    view.indexOf("async function handleFinalize"),
  );
  assert.ok(download.indexOf("collectArchiveDownload") < download.indexOf("XLSX.writeFile"));
  assert.ok(download.indexOf("XLSX.writeFile") < download.indexOf("new Set(current).add"));
  assert.match(
    view,
    /className="btn-primary"\s*disabled=\{busyId !== null \|\| preparing\}\s*onClick=\{\(\) => handleDownload\(archive\)\}/,
  );
});
