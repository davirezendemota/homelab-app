export function isMockMode(): boolean {
  const v = process.env.HOMELAB_MOCK;
  return v === "1" || v === "true" || v === "yes";
}
