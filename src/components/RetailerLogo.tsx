import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  canonicalRetailerName,
  retailerLogoPath,
} from "@/lib/retailerNames";

type RetailerLogoProps = {
  retailer?: string | null;
  className?: string;
  imageClassName?: string;
  nameClassName?: string;
  showName?: boolean;
};

type RetailerArtworkProps = {
  logo: string | null;
  name: string;
};

function RetailerArtwork({ logo, name }: RetailerArtworkProps) {
  const [imageFailed, setImageFailed] = useState(false);

  if (!logo || imageFailed) {
    return (
      <span
        className="flex h-full w-full items-center justify-center rounded-md bg-slate-100 px-1 text-center text-[10px] font-extrabold leading-none text-slate-800 dark:bg-slate-800 dark:text-slate-100"
        aria-label={name}
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <span className="relative flex h-full w-full min-w-0 items-center justify-center bg-transparent">
      <img
        src={logo}
        alt=""
        className="h-full w-full object-contain"
        loading="lazy"
        decoding="async"
        onError={() => setImageFailed(true)}
      />
    </span>
  );
}

export default function RetailerLogo({
  retailer,
  className,
  imageClassName,
  nameClassName,
  showName = false,
}: RetailerLogoProps) {
  const name = canonicalRetailerName(retailer);
  const logo = retailerLogoPath(retailer);

  if (!name) return null;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span
        className={cn(
          "flex h-7 w-12 shrink-0 items-center justify-center overflow-hidden bg-transparent p-0",
          imageClassName,
        )}
        aria-label={showName ? undefined : name}
      >
        <RetailerArtwork key={logo ?? name} logo={logo} name={name} />
      </span>
      {showName && (
        <span
          className={cn(
            "min-w-0 truncate text-[11px] text-muted-foreground",
            nameClassName,
          )}
        >
          {name}
        </span>
      )}
    </span>
  );
}
