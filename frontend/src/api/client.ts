import { createContext, useContext } from 'react'

import { errorText } from '../components/common-utils'

import type {
  Info,
  Insight,
  Listing,
  Problem,
  ProblemItem,
  ProjectResult,
  Sensitivity,
} from './types'

/** API がエラーを返したときの例外 */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** 誤りの応答から画面の文を作る (本文が JSON でなければ状態の番号と文) */
async function readError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined)
  return errorText(response.status, response.statusText, body)
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

/**
 * API の頭 (単独では `/api`, 殻の下では `/api/problem` など) の下に送る呼び出しの一式を作る
 *
 * @param base - API の頭 (末尾の `/` は無し)
 */
export function createApi(base: string) {
  return {
    info: () => request<Info>(`${base}/info`),
    browse: (path: string) => request<Listing>(`${base}/browse?path=${encodeURIComponent(path)}`),
    problems: () => request<ProblemItem[]>(`${base}/problems`),
    problem: (id: string) => request<Problem>(`${base}/problems/${id}`),
    problemVersion: (id: string) => request<{ version: string }>(`${base}/problems/${id}/version`),
    create: (body: { name?: string; example?: string }) =>
      request<Problem>(`${base}/problems`, json('POST', body)),
    importProblem: (path: string) =>
      request<Problem>(`${base}/problems/import`, json('POST', { path })),
    answer: (id: string, question: string, value: unknown) =>
      request<Problem>(`${base}/problems/${id}/answers`, json('PUT', { id: question, value })),
    rename: (id: string, name: string) =>
      request<Problem>(`${base}/problems/${id}/name`, json('PUT', { name })),
    attachData: (id: string, path: string) =>
      request<Problem>(`${base}/problems/${id}/data`, json('POST', { path })),
    detachData: (id: string) =>
      request<Problem>(`${base}/problems/${id}/data`, { method: 'DELETE' }),
    insight: (id: string) => request<Insight>(`${base}/problems/${id}/insight`),
    readColumns: (id: string, path: string) =>
      request<Problem>(`${base}/problems/${id}/columns`, json('POST', { path })),
    sensitivity: (id: string, ranges: Record<string, [number, number]>, points: number) =>
      request<Sensitivity>(`${base}/problems/${id}/sensitivity`, json('POST', { ranges, points })),
    writeProject: (
      id: string,
      body: { path: string; name?: string; overwrite?: boolean; accept_errors?: boolean },
    ) => request<ProjectResult>(`${base}/problems/${id}/project`, json('POST', body)),
    remove: (id: string) => request<void>(`${base}/problems/${id}`, { method: 'DELETE' }),
    downloadUrl: (id: string) => `${base}/problems/${id}/download`,
  }
}

/** 呼び出しの一式の型 */
export type Api = ReturnType<typeof createApi>

/** 根の部品が決めた呼び出しの一式 (部品の外では単独の頭 `/api`) */
export const ApiContext = createContext<Api>(createApi('/api'))

/** 根の部品が決めた API の頭の下に送る呼び出しの一式を使う */
export function useApi(): Api {
  return useContext(ApiContext)
}
