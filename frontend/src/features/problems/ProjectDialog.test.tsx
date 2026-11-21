import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { Finding, Problem, Question } from '../../api/types'
import { ProjectDialog } from './ProjectDialog'

/** 正解の種類の問い (受け渡しの値が無くても答えから読む) */
const KIND: Question = {
  id: 'ml.parts.0.target.kind',
  section: 5,
  kind: 'choice',
  title: '正解の種類は',
  help: '',
  required: true,
  choices: [],
  value: 'mask',
  answered: true,
  applies: true,
}

/** 課題の持ち主の問い (確かめの項目の場所の題) */
const OWNER: Question = { ...KIND, id: 'issue.owner', section: 1, title: '誰の課題ですか' }

/** 直すところが残る (受け渡せないが組める) 問題の設定 */
function problemWith(errors: Finding[]): Problem {
  return {
    id: '0123456789ab',
    name: '試し',
    created_at: null,
    updated_at: null,
    uses_ml: true,
    questions: [KIND, OWNER],
    progress: { answered: 0, required: 0, sections: [] },
    findings: errors,
    summary: [],
    handoff: null,
    handoff_error: '直すところが残っています',
    requires: [],
    ready: false,
    exportable: true,
    export_error: null,
    open_errors: errors,
    finished: false,
    file_version: 2,
    version: 'x',
  }
}

/** 対話を描く (問い合わせの部品で包む) */
function renderDialog(problem: Problem) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ProjectDialog problem={problem} onClose={() => undefined} />
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  // jsdom の dialog は showModal を持たない
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProjectDialog', () => {
  it('直すところが残れば一覧を出し, 確かめたときだけ accept_errors を送る', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderDialog(problemWith([{ level: 'error', id: 'issue.owner', message: '答えてください' }]))

    // 一覧と, 答えから読んだ正解の種類 (画像の領域) の説明
    const list = screen.getByRole('list', { name: '残っている直すところ' })
    expect(list).toHaveTextContent('1. 誰の課題ですか: 答えてください')
    expect(screen.getByLabelText(/実験の名前/)).toBeInTheDocument()
    expect(screen.getByText(/正解の種類と受け持ちから/)).toBeInTheDocument()

    // 確かめるまで押せない
    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    const submit = screen.getByRole('button', { name: '書き出す' })
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /それでも書き出す/ }))
    const accepted = screen.getByRole('button', { name: '直すところが残ったまま書き出す' })
    expect(accepted).toBeEnabled()
    fireEvent.click(accepted)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(String(init.body))).toMatchObject({ path: '/x', accept_errors: true })

    // 書き出した後は, 場所などを変えるまで押せない
    expect(await screen.findByRole('button', { name: '書き出しました' })).toBeDisabled()
  })

  it('入れたデータの確かめだけなら渡す値は作れると書き, 損得と制約が残れば既定値を付けないと添える', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const problem = problemWith([
      { level: 'error', id: 'action.decision', message: '目的の列の値が 2 種類でありません' },
    ])
    renderDialog({
      ...problem,
      questions: [{ ...KIND, value: 'column' }, OWNER],
      handoff: {} as Problem['handoff'],
      ready: true,
    })
    const note = screen.getByText(/渡す値は作れますが/)
    expect(note).toHaveTextContent('既定値を付けずに作ります')
    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /それでも書き出す/ }))
    fireEvent.click(screen.getByRole('button', { name: '直すところが残ったまま書き出す' }))
    const next = await screen.findByText(/inference\/ を ML-Provide に登録して推論する/)
    expect(next).toHaveTextContent('README.md の最後の一覧を直すまで問題の設定はつながない')
    expect(next).toHaveTextContent('一式に意思決定の既定値は付かない')
  })

  it('直すところが無ければ確かめを出さず, accept_errors を送らない', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderDialog(problemWith([]))
    expect(screen.queryByRole('checkbox', { name: /それでも書き出す/ })).toBeNull()
    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(String(init.body))).not.toHaveProperty('accept_errors')
  })
})
