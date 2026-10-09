/**
 * Global App Configuration & API Endpoints
 */

export const CONFIG = {
  API_BASE_URL: import.meta.env.PROD 
    ? 'https://your-production-backend.onrender.com/api' 
    : 'http://localhost:4000/api',
  VERSION: '1.0.0'
};
