export function parsePositiveInteger(
  value: string | undefined,
  flagName: string,
  options: { min?: number; max?: number } = {},
): number {
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${flagName}: expected an integer from ${min} to ${max}`);
  }

  return parsed;
}
