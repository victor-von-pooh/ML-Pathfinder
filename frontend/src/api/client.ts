import type { Info, Insight, Listing, Problem, ProblemItem, ProjectResult } from './types'

/** API がエラーを返したときの例外 */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** エラーのレスポンスから表示する文を取り出す */
async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'detail' in body) {
      const detail = (body as { detail: unknown }).detail
      if (typeof detail === 'string') return detail
      return JSON.stringify(detail)
    }
  } catch {
    // JSON でない場合は状態の文を使う
  }
  return `${response.status} ${response.statusText}`
}

/** JSON の API を呼ぶ */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    throw new ApiError(response.status, await readError(response))
  }
  // 中身の無い応答 (消した場合の 204) は undefined
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
})

export const api = {
  info: () => request<Info>('/api/info'),
  browse: (path: string) => request<Listing>(`/api/browse?path=${encodeURIComponent(path)}`),
  problems: () => request<ProblemItem[]>('/api/problems'),
  problem: (id: string) => request<Problem>(`/api/problems/${id}`),
  create: (body: { name?: string; example?: string }) =>
    request<Problem>('/api/problems', json('POST', body)),
  importProblem: (path: string) => request<Problem>('/api/problems/import', json('POST', { path })),
  answer: (id: string, question: string, value: unknown) =>
    request<Problem>(`/api/problems/${id}/answers`, json('PUT', { id: question, value })),
  rename: (id: string, name: string) =>
    request<Problem>(`/api/problems/${id}/name`, json('PUT', { name })),
  attachData: (id: string, path: string) =>
    request<Problem>(`/api/problems/${id}/data`, json('POST', { path })),
  detachData: (id: string) => request<Problem>(`/api/problems/${id}/data`, { method: 'DELETE' }),
  insight: (id: string) => request<Insight>(`/api/problems/${id}/insight`),
  readColumns: (id: string, path: string) =>
    request<Problem>(`/api/problems/${id}/columns`, json('POST', { path })),
  writeProject: (id: string, body: { path: string; name?: string; overwrite?: boolean }) =>
    request<ProjectResult>(`/api/problems/${id}/project`, json('POST', body)),
  remove: (id: string) => request<void>(`/api/problems/${id}`, { method: 'DELETE' }),
  downloadUrl: (id: string) => `/api/problems/${id}/download`,
}
