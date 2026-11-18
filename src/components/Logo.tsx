import React from "react";

export function Logo({
  size = "md",
  showTag = true,
}: {
  size?: "sm" | "md" | "lg";
  showTag?: boolean;
}) {
  const iconDim =
    size === "sm" ? "h-7 w-7" : size === "lg" ? "h-9 w-9" : "h-8 w-8";
  const textClass =
    size === "sm"
      ? "text-base"
      : size === "lg"
      ? "text-xl"
      : "text-[17px]";

  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <span
        className={`${iconDim} inline-flex items-center justify-center rounded-xl bg-blue-600 text-white shadow-subtle`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-4 w-4"
          aria-hidden="true"
        >
          {/* Crop corner brackets + central play spark */}
          <path
            d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <path
            d="M10 8.8L15.8 12L10 15.2V8.8Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span
        className={`${textClass} font-extrabold tracking-tight text-zinc-950 flex items-center gap-1.5`}
      >
        <span>CLIPX</span>
        {showTag && (
          <span className="rounded-md bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-blue-700">
            AI
          </span>
        )}
      </span>
    </span>
  );
}
