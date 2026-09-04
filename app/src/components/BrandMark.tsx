/**
 * Compact #106 hex mark for public chrome. Source of truth is
 * assets/logo/logo-mark.svg (64×64); copies live in app/public/.
 * Below 180 px lockup width the brand guide uses the mark alone.
 */
export function BrandMark({
  depth = 0,
  size = 24,
  alt = "Free AI Credits",
  priority = false,
}: {
  depth?: number;
  size?: number;
  alt?: string;
  priority?: boolean;
}) {
  const prefix = "../".repeat(depth) || "./";
  return (
    <img
      className="brand-mark"
      src={`${prefix}logo-mark.svg`}
      width={size}
      height={size}
      alt={alt}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      style={{ aspectRatio: "1 / 1" }}
    />
  );
}
