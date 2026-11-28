import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, request } from './client'

/** 誤りの応答を返す fetch を置き, 投げた誤りを返す */
async function failWith(response: Response): Promise<ApiError> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response),
  )
  try {
    await request('/api/x')
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('誤りになりませんでした')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('request の誤りの文 (殻の R12 の errorText)', () => {
  it('入力の検証の誤り (422) は欄ごとに 1 行にする', async () => {
    const error = await failWith(
      Response.json(
        {
          detail: [
            { loc: ['body', 'path'], msg: '要ります' },
            { loc: ['body', 'ranges', 'cost'], msg: '数ではありません' },
          ],
        },
        { status: 422, statusText: 'Unprocessable Content' },
      ),
    )
    expect(error.status).toBe(422)
    expect(error.message).toBe('path: 要ります\nranges.cost: 数ではありません')
  })

  it('既定の 404 は経路の誤りとして出し, 画面の文はそのまま出す', async () => {
    const route = await failWith(
      Response.json({ detail: 'Not Found' }, { status: 404, statusText: 'Not Found' }),
    )
    expect(route.message).toBe('API の経路が見つかりません (404)')
    const conflict = await failWith(
      Response.json({ detail: { message: '直すところが残っています' } }, { status: 409 }),
    )
    expect(conflict.message).toBe('直すところが残っています')
  })

  it('本文が JSON でなければ状態の番号と文を出す', async () => {
    const error = await failWith(new Response('oops', { status: 502, statusText: 'Bad Gateway' }))
    expect(error.message).toBe('502 Bad Gateway')
  })
})
