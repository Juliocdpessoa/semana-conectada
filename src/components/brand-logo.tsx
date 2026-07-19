import logoAsset from "@/assets/normatel-logo.png.asset.json";

export function BrandLogo({
  className = "h-8 w-auto",
  alt = "Normatel Engenharia",
}: {
  className?: string;
  alt?: string;
}) {
  return <img src={logoAsset.url} alt={alt} className={className} />;
}
