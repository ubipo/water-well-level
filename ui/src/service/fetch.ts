const API_BASE_URL_PARAM_KEY = "a"
const API_BASE_URL_LOCAL_STORAGE_KEY = "apiBaseUrl"

export function getApiBaseUrl(): string {
  const pageParams = new URLSearchParams(window.location.search)
  const lambdaBaseUrl = pageParams.get(API_BASE_URL_PARAM_KEY)
  if (lambdaBaseUrl == null) {
    const localStorageLambdaBaseUrl = localStorage.getItem(API_BASE_URL_LOCAL_STORAGE_KEY)
    if (localStorageLambdaBaseUrl == null) {
      throw new Error(`API base URL not found as url parameter ('${API_BASE_URL_PARAM_KEY}') or in local storage`)
    }
    return localStorageLambdaBaseUrl
  }
  localStorage.setItem(API_BASE_URL_LOCAL_STORAGE_KEY, lambdaBaseUrl)
  return lambdaBaseUrl
}

export function createRequestInit(password: string): RequestInit {
  return {
    headers: {
      "Authorization": `Bearer ${password}`,
    },
  }
}
