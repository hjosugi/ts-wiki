const configuredApiUrl = import.meta.env.VITE_API_URL?.trim()

export const API_BASE_URL = configuredApiUrl || window.location.origin
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws')
