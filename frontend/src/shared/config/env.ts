function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '')
}

const configuredBaseUrl = import.meta.env.VITE_API_BASE
const developmentBaseUrl = 'http://127.0.0.1:8000'

export const API_BASE_URL = normalizeBaseUrl(
  configuredBaseUrl === undefined
    ? import.meta.env.DEV
      ? developmentBaseUrl
      : ''
    : configuredBaseUrl,
)
