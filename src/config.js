/**
 * Global App Configuration & API Endpoints
 */

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const CONFIG = {
  // Empty means same-origin, which works with a reverse proxy or a co-hosted API.
  // Set VITE_API_BASE_URL at build time only when the API is hosted elsewhere.
  API_BASE_URL: configuredApiBaseUrl ? configuredApiBaseUrl.replace(/\/$/, '') : '',
  VERSION: '1.0.0'
};
