import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Question, Sensitivity } from '../../api/types'
import { SensitivityPanel } from './SensitivityPanel'

/** 振り分ける型の意思決定の問い (見逃しの損は列で書いた) */
const DECISION: Question = {
  id: 'action.decision',
  section: 7,
  kind: 'decision',
  title: '損得と制約は',
  help: '',
  required: false,
  choices: [
    {
      value: 'triage',
      label: '振り分ける',
      fields: [
        { key: 'miss_cost', label: '見逃しの損', required: true },
        { key: 'false_alarm_cost', label: '空振りの損', required: true },
        { key: 'capacity', label: '回せる件数', required: false },
      ],
    },
  ],
  value: { type: 'triage', miss_cost: 'loss', false_alarm_cost: 50, capacity: 20 },
  answered: true,
  applies: true,
  multiline: false,
}

const FIELDS = { triage: ['miss_cost', 'false_alarm_cost', 'capacity'] }

/** 回せる件数より空振りの損が決め手になる結果 */
const RESULT: Sensitivity = {
  type: 'triage',
  rule: '回す確率のしきい値',
  base: { rule: null, limit: 20, loss: { current: 900, none: 1000, all: 800 }, best: 'all' },
  fields: [
    {
      field: 'capacity',
      label: '回せる件数',
      points: [
        { value: 10, rule: null, limit: 10, loss: { current: 900 }, best: 'all' },
        { value: 30, rule: null, limit: 30, loss: { current: 900 }, best: 'all' },
      ],
      swing: { rule: null, loss: 0 },
      sentence: '回せる件数を 10 から 30 に変えると',
    },
    {
      field: 'false_alarm_cost',
      label: '空振りの損',
      points: [
        { value: 10, rule: null, limit: 20, loss: { current: 500 }, best: 'current' },
        { value: 90, rule: null, limit: 20, loss: { current: 1300 }, best: 'none' },
      ],
      swing: { rule: null, loss: 800 },
      sentence: '空振りの損を 10 から 90 に変えると',
    },
  ],
  data: { rows: 40, days: null },
  notes: ['行動の件数と量そのものは予測が無いと求まりません'],
}

function renderPanel(question: Question = DECISION) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <SensitivityPanel
        problemId="0123456789ab"
        question={question}
        fields={FIELDS}
        plans={{ current: '今のやり方', none: 'どれも回さない', all: '全てを回す' }}
      />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SensitivityPanel', () => {
  it('開くまで呼ばず, 書いた幅を送り, 振れ幅の大きい順に表を出す', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(RESULT))
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()
    expect(screen.queryByLabelText('空振りの損の下')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '値を決める手伝い' }))

    // 列で書いた項目は幅を渡せない
    expect(screen.queryByLabelText('見逃しの損の下')).not.toBeInTheDocument()
    expect(screen.getByText(/行動の件数と量そのものは予測が要るので出しません/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('空振りの損の下'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('空振りの損の上'), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText('回せる件数の下'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('回せる件数の上'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('点の数 (両端を含む)'), { target: { value: '3' } })
    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '求める' }))

    const sections = await screen.findAllByRole('region', { name: /の幅$/ })
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual([
      '空振りの損の幅',
      '回せる件数の幅',
    ])
    expect(within(sections[0]!).getByText('決め手')).toBeInTheDocument()
    expect(within(sections[0]!).getByText('どれも回さない')).toBeInTheDocument()
    expect(within(sections[0]!).getByText('空振りの損を 10 から 90 に変えると')).toBeInTheDocument()
    expect(within(sections[1]!).getByText('30 件')).toBeInTheDocument()
    expect(screen.getByText('行動の件数と量そのものは予測が無いと求まりません')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/problems/0123456789ab/sensitivity')
    expect(JSON.parse(String(init?.body))).toEqual({
      ranges: { false_alarm_cost: [10, 90], capacity: [10, 30] },
      points: 3,
    })
  })

  it('幅の書き損じは送らず, サーバーの誤りの文は画面の誤りに出す', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ detail: 'capacity の幅は, 下を上以下にしてください' }, { status: 400 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '値を決める手伝い' }))
    fireEvent.change(screen.getByLabelText('回せる件数の下'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '求める' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '回せる件数の幅は, 下と上の両方を書いてください',
    )
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('回せる件数の上'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: '求める' }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'capacity の幅は, 下を上以下にしてください',
      ),
    )
  })

  it('意思決定しない問題の設定では出さない', () => {
    const { container } = renderPanel({ ...DECISION, value: { type: 'none' } })
    expect(container).toBeEmptyDOMElement()
  })
})
