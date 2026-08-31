import logoAsset from "@/assets/normatel-logo.png.asset.json";
import type { ImgHTMLAttributes } from "react";

export function BrandLogo({
  className = "h-8 w-auto",
  alt = "Normatel Engenharia",
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  return <img src={logoAsset.url} alt={alt} className={className} {...props} />;
}

