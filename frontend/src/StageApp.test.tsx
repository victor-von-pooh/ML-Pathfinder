import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Info, Problem, ProblemItem } from './api/types'
import { ThemeProvider } from './lib/theme'
import { useTheme } from './lib/themeContext'
import { StageApp, type StageAppProps } from './StageApp'

/** 1 つの問題の設定 (問いの無い, 作ったばかりの形) */
function problemOf(id: string, name: string): Problem {
  return {
    id,
    name,
    created_at: null,
    updated_at: null,
    uses_ml: null,
    questions: [],
    progress: {
      answered: 0,
      required: 0,
      sections: [{ number: 1, title: '課題', answered: 0, required: 0 }],
    },
    findings: [],
    summary: [],
    handoff: null,
    handoff_error: null,
    requires: [],
    ready: false,
    exportable: false,
    export_error: null,
    skeleton_type: null,
    open_errors: [],
    finished: false,
    file_version: 2,
    version: 'v1',
  }
}

const INFO: Info = {
  format_version: 2,
  sections: [{ number: 1, title: '課題' }],
  examples: [],
  splits: [],
  sensitivity_fields: {},
}

const ITEMS: ProblemItem[] = [
  {
    id: 'aaaaaaaaaaaa',
    name: '総菜の作る量',
    updated_at: null,
    uses_ml: null,
    progress: { answered: 0, required: 0, sections: [] },
    errors: 0,
    ready: false,
    finished: false,
  },
]

/** API の頭 `/api/problem` の下だけに答える fetch (他の場所を呼べば 404) */
function stubApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (!url.startsWith('/api/problem/')) return new Response(null, { status: 404 })
    const path = url.slice('/api/problem'.length)
    if (path === '/info') return Response.json(INFO)
    if (path === '/problems' && method === 'GET') return Response.json(ITEMS)
    if (path === '/problems' && method === 'POST') {
      return Response.json(problemOf('bbbbbbbbbbbb', '新しい課題'))
    }
    const match = /^\/problems\/(\w+)(\/version)?$/.exec(path)
    if (match?.[2]) return Response.json({ version: 'v1' })
    if (match) {
      const id = match[1] ?? ''
      return Response.json(problemOf(id, id === 'aaaaaaaaaaaa' ? '総菜の作る量' : '新しい課題'))
    }
    return new Response(null, { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 殻の下の形 (経路の頭 `/problem`, API の頭 `/api/problem`) で描く */
function renderStage(props: Partial<StageAppProps> = {}) {
  const onProjectChange = vi.fn()
  const onProjectsChange = vi.fn()
  const onProgressChange = vi.fn()
  const view = render(
    <StageApp
      basename="/problem"
      apiBase="/api/problem"
      project={null}
      onProjectChange={onProjectChange}
      onProjectsChange={onProjectsChange}
      embedded
      onProgressChange={onProgressChange}
      {...props}
    />,
  )
  return { ...view, onProjectChange, onProjectsChange, onProgressChange }
}

beforeEach(() => {
  window.history.replaceState(null, '', '/problem')
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('StageApp', () => {
  it('API を全て apiBase の下に呼び, project が null なら一覧を出す', async () => {
    const fetchMock = stubApi()
    renderStage()
    expect(await screen.findByRole('link', { name: '総菜の作る量' })).toHaveAttribute(
      'href',
      '/problem/problems/aaaaaaaaaaaa',
    )
    const urls = fetchMock.mock.calls.map(([input]) => String(input))
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(url.startsWith('/api/problem/')).toBe(true)
  })

  it('project を渡すと, 一覧を経ずにその問題の設定を開き, 同じ値なら知らせない', async () => {
    stubApi()
    const { onProjectChange } = renderStage({ project: 'aaaaaaaaaaaa' })
    expect(await screen.findByRole('heading', { name: '総菜の作る量' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/problem/problems/aaaaaaaaaaaa')
    expect(onProjectChange).not.toHaveBeenCalled()
  })

  it('殻が project を替えると, その問題の設定を開き直す', async () => {
    stubApi()
    const { rerender, onProjectChange, onProjectsChange } = renderStage({
      project: 'aaaaaaaaaaaa',
    })
    await screen.findByRole('heading', { name: '総菜の作る量' })
    rerender(
      <StageApp
        basename="/problem"
        apiBase="/api/problem"
        project="bbbbbbbbbbbb"
        onProjectChange={onProjectChange}
        onProjectsChange={onProjectsChange}
        embedded
      />,
    )
    expect(await screen.findByRole('heading', { name: '新しい課題' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/problem/problems/bbbbbbbbbbbb')
    expect(onProjectChange).not.toHaveBeenCalled()
  })

  it('作ると一覧の変化と開いた問題の設定を知らせる', async () => {
    stubApi()
    const { onProjectChange, onProjectsChange, onProgressChange } = renderStage()
    fireEvent.change(await screen.findByLabelText(/問題の名前/), {
      target: { value: '新しい課題' },
    })
    fireEvent.click(screen.getByRole('button', { name: '作る' }))
    expect(await screen.findByRole('heading', { name: '新しい課題' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/problem/problems/bbbbbbbbbbbb')
    expect(onProjectsChange).toHaveBeenCalledTimes(1)
    expect(onProgressChange).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith('bbbbbbbbbbbb'))
  })

  it('殻が project を替えても履歴を増やさない', async () => {
    stubApi()
    const { rerender, onProjectChange, onProjectsChange } = renderStage({ project: 'aaaaaaaaaaaa' })
    await screen.findByRole('heading', { name: '総菜の作る量' })
    const before = window.history.length
    rerender(
      <StageApp
        basename="/problem"
        apiBase="/api/problem"
        project="bbbbbbbbbbbb"
        onProjectChange={onProjectChange}
        onProjectsChange={onProjectsChange}
        embedded
      />,
    )
    await screen.findByRole('heading', { name: '新しい課題' })
    expect(window.history.length).toBe(before)
  })

  it('一覧から開くと, 開いた問題の設定を知らせる', async () => {
    stubApi()
    const { onProjectChange } = renderStage()
    fireEvent.click(await screen.findByRole('link', { name: '総菜の作る量' }))
    await waitFor(() => expect(onProjectChange).toHaveBeenCalledWith('aaaaaaaaaaaa'))
  })

  it('embedded ではアプリの名前と明暗の切り替えを出さず, 一覧への移動は出す', async () => {
    stubApi()
    renderStage()
    await screen.findByRole('link', { name: '総菜の作る量' })
    expect(screen.queryByText('ML-Pathfinder')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /表示にする/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '問題の設定' }).length).toBeGreaterThan(0)
  })

  it('読むだけの明暗は html のクラスを書き換えず, 殻の切り替えを読み直す', async () => {
    function Shown() {
      return <p>{useTheme().theme}</p>
    }
    render(
      <ThemeProvider readOnly>
        <Shown />
      </ThemeProvider>,
    )
    expect(screen.getByText('light')).toBeInTheDocument()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    document.documentElement.classList.add('dark')
    expect(await screen.findByText('dark')).toBeInTheDocument()
  })

  it('単独では名前と明暗の切り替えを出し, 開いた URL のまま描く', async () => {
    stubApi()
    window.history.replaceState(null, '', '/problems/aaaaaaaaaaaa')
    render(
      <StageApp
        basename=""
        apiBase="/api/problem"
        project={null}
        onProjectChange={() => {}}
        onProjectsChange={() => {}}
        embedded={false}
      />,
    )
    expect(await screen.findByRole('heading', { name: '総菜の作る量' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/problems/aaaaaaaaaaaa')
    expect(screen.getAllByText('ML-Pathfinder').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: '暗い表示にする' })[0]!)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
