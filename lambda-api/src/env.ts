export function envStringOrThrow(key: string) {
  const value = process.env[key];
  if (!(typeof value == "string" && value.length > 0)) {
    throw new Error(`Environment variable must be set and non-empty: ${key}`);
  }
  return value;
}
