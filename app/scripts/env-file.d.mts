/**
 * Types for env-file.mjs. It stays plain ESM because scripts/prerender.mjs
 * imports it from Node directly, with no build step to strip types.
 */
export function readEnvFile(dir: string): Record<string, string>;

export function envValue(
  key: string,
  dir: string,
  env?: NodeJS.ProcessEnv,
): string | undefined;
