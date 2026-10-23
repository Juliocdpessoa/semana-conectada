import { rsAlert } from "@/lib/rs-alert";
export function RsAlertBadge({
  value,
  included = true,
}: {
  value: number | null;
  included?: boolean;
}) {
  const alert = rsAlert(value, included);
  return (
    <span
      title={alert.label}
      className={`inline-flex flex-col rounded border px-2 py-1 ${alert.className}`}
    >
      <span className="font-semibold">
        {!included
          ? "Acompanhamento"
          : value === null
            ? "—"
            : value.toLocaleString("pt-BR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }) + "%"}
      </span>
      <span className="text-[10px]">{alert.label}</span>
    </span>
  );
}
