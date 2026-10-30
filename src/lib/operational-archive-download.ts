export const ARCHIVE_PAGE_SIZE = 200;
export const ARCHIVE_BATCH_SIZE = 50;

export type ArchiveDownloadInfo = {
  id: string;
  cutoff_date: string;
  prepared_at: string;
  overtime_count: number;
  scale_change_count: number;
};
export type ArchiveDownloadRow = {
  id: string | number;
  source_type: string;
  record_date: string;
  payload: Record<string, unknown>;
};
export type ArchiveDownloadPage = {
  archive: ArchiveDownloadInfo;
  rows: ArchiveDownloadRow[];
  nextOffset: number | null;
};

export function archiveBatchChunks(ids: string[]) {
  const unique = [...new Set(ids)];
  return Array.from({ length: Math.ceil(unique.length / ARCHIVE_BATCH_SIZE) }, (_, i) =>
    unique.slice(i * ARCHIVE_BATCH_SIZE, (i + 1) * ARCHIVE_BATCH_SIZE),
  );
}

function identity(archive: ArchiveDownloadInfo) {
  return JSON.stringify([
    archive.id,
    archive.cutoff_date,
    archive.prepared_at,
    archive.overtime_count,
    archive.scale_change_count,
  ]);
}

/** Keep partial pages local. No workbook or finalization until every record is checked. */
export async function collectArchiveDownload(
  expected: ArchiveDownloadInfo,
  loadPage: (offset: number) => Promise<ArchiveDownloadPage>,
  onProgress: (loaded: number, total: number) => void = () => {},
) {
  const total = expected.overtime_count + expected.scale_change_count;
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(expected.overtime_count) ||
    expected.overtime_count < 0 ||
    !Number.isSafeInteger(expected.scale_change_count) ||
    expected.scale_change_count < 0
  )
    throw new Error("Quantidades inválidas no arquivo histórico.");
  const rows: ArchiveDownloadRow[] = [];
  const seen = new Set<string>();
  let overtime = 0,
    scale = 0,
    offset = 0;
  onProgress(0, total);
  do {
    const page = await loadPage(offset);
    if (!page || identity(page.archive) !== identity(expected))
      throw new Error("O arquivo histórico mudou. Atualize a lista e tente novamente.");
    if (!Array.isArray(page.rows) || page.rows.length > ARCHIVE_PAGE_SIZE)
      throw new Error("Bloco inválido no download do histórico.");
    for (const row of page.rows) {
      const id = String(row.id ?? "");
      if (!id || seen.has(id))
        throw new Error("Registro ausente ou repetido no download. Tente novamente.");
      seen.add(id);
      if (row.source_type === "overtime") overtime++;
      else if (row.source_type === "scale_change") scale++;
      else throw new Error("Tipo de registro desconhecido no arquivo histórico.");
      rows.push(row);
    }
    if (
      rows.length > total ||
      overtime > expected.overtime_count ||
      scale > expected.scale_change_count
    )
      throw new Error("As quantidades do histórico não conferem. Nenhum arquivo foi gerado.");
    const next = rows.length < total ? offset + page.rows.length : null;
    if ((next !== null && next <= offset) || page.nextOffset !== next)
      throw new Error(
        "Download incompleto do histórico. Tente novamente; o arquivo salvo permanece disponível.",
      );
    onProgress(rows.length, total);
    if (next === null) break;
    offset = next;
  } while (true);
  if (overtime !== expected.overtime_count || scale !== expected.scale_change_count)
    throw new Error("As quantidades por tipo não conferem. Nenhum arquivo foi gerado.");
  return rows;
}
