/**
 * Resolves the URL to HCTeams Hub.
 * Priority:
 * 1. If running on production (*.yuk-damel.web.id), always point to https://hub.yuk-damel.web.id (unless non-localhost envUrl is explicitly provided).
 * 2. Explicit VITE_HUB_URL environment variable.
 * 3. Fallback to local development port http://localhost:5174.
 */
export function getHubUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_HUB_URL;
  if (typeof window !== 'undefined' && window.location.hostname.includes('yuk-damel.web.id')) {
    if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
      return envUrl;
    }
    return 'https://hub.yuk-damel.web.id';
  }
  return envUrl || 'http://localhost:5174';
}
