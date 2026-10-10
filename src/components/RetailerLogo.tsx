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
  const kawakami = name === "Kawakami";

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
    <span
      className={cn(
        "relative flex h-full w-full min-w-0 items-center justify-center",
        kawakami && "rounded-md bg-white px-0.5 py-0.5 ring-1 ring-slate-200/70",
      )}
    >
      <img
        src={logo}
        alt=""
        className={cn(
          "h-full w-full object-contain",
          kawakami && "pb-2",
        )}
        loading="lazy"
        decoding="async"
        onError={() => setImageFailed(true)}
      />
      {kawakami && (
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 truncate text-center text-[8px] font-extrabold leading-none tracking-tight text-emerald-800"
          aria-hidden="true"
        >
          Kawakami
        </span>
      )}
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
