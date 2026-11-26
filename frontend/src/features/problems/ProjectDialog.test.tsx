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
  multiline: false,
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

    // 書き出した後は, 場所などを変えるまで押せない. 領域の一式も確かめて書き出したと添える
    expect(await screen.findByRole('button', { name: '書き出しました' })).toBeDisabled()
    expect(screen.getByText(/inference\/ に推論の一式を作るので/)).toHaveTextContent(
      'README.md の最後の一覧を直すまで問題の設定はつながない',
    )
  })

  it('ファイルの組では損得と制約の注意を出さない', () => {
    renderDialog(
      problemWith([{ level: 'error', id: 'action.decision.value', message: '数を答えてください' }]),
    )
    expect(screen.getByText(/渡す値を作れず/)).toBeInTheDocument()
    expect(screen.queryByText(/既定値を付けずに/)).toBeNull()
  })

  it('作るで画像は, 画像の生成の次にすることを出し, 損得と制約の注意を出さない', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'generate' }
    const problem = problemWith([
      { level: 'error', id: 'action.decision.value', message: '数を答えてください' },
    ])
    renderDialog({ ...problem, questions: [{ ...KIND, value: 'image' }, role, OWNER] })
    expect(screen.getByText(/正解の種類と受け持ちから/)).toBeInTheDocument()
    expect(screen.queryByText(/既定値を付けずに/)).toBeNull()

    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /それでも書き出す/ }))
    fireEvent.click(screen.getByRole('button', { name: '直すところが残ったまま書き出す' }))
    expect(await screen.findByText(/目的の列の無いレシピ/)).toBeInTheDocument()
    expect(screen.getByText(/件数と種で画像を作る/)).toHaveTextContent(
      'README.md の最後の一覧を直すまで問題の設定はつながない',
    )
    expect(screen.queryByText(/意思決定の既定値は付かない/)).toBeNull()
  })

  it('作るで表は, 表の生成の次にすることを出し, 損得と制約の注意を出さない', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'generate' }
    const problem = problemWith([
      { level: 'error', id: 'action.decision.value', message: '数を答えてください' },
    ])
    renderDialog({ ...problem, questions: [{ ...KIND, value: 'table' }, role, OWNER] })
    expect(screen.getByText(/正解の種類と受け持ちから/)).toBeInTheDocument()
    expect(screen.queryByText(/既定値を付けずに/)).toBeNull()

    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /それでも書き出す/ }))
    fireEvent.click(screen.getByRole('button', { name: '直すところが残ったまま書き出す' }))
    expect(await screen.findByText(/ML-Fathom で表を読み/)).toBeInTheDocument()
    expect(screen.getByText(/diffusion_denoiser/)).toBeInTheDocument()
    expect(screen.getByText(/列ごとの分布の近さ/)).toHaveTextContent('小さいほど良い')
    expect(screen.getByText(/行の数と種で表を作る/)).toHaveTextContent(
      'README.md の最後の一覧を直すまで問題の設定はつながない',
    )
    // 列の予測の手順と画像の生成の手順は出さない
    expect(screen.queryByText(/右の「データの分析」の値/)).toBeNull()
    expect(screen.queryByText(/画像を作る/)).toBeNull()
    expect(screen.queryByText(/意思決定の既定値は付かない/)).toBeNull()
  })

  it('並べるは, 並べるの次にすることと品物の列の実験の名前を出し, 損得と制約の注意を出さない', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'rank' }
    const method: Question = { ...KIND, id: 'ml.parts.0.method', value: 'scratch' }
    const problem = problemWith([
      { level: 'error', id: 'action.decision.value', message: '数を答えてください' },
    ])
    // 並べるは正解の種類の問いが要らない (古い答えが残っていても並べるの説明)
    renderDialog({ ...problem, questions: [{ ...KIND, applies: false }, role, method, OWNER] })
    expect(screen.getByText(/品物の列と受け持ちから/)).toBeInTheDocument()
    expect(screen.getByText(/反応の表とモデルの定義を置いて学習します/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /それでも書き出す/ }))
    fireEvent.click(screen.getByRole('button', { name: '直すところが残ったまま書き出す' }))
    expect(await screen.findByText(/反応の表 \(1 行が 1 つの反応/)).toBeInTheDocument()
    expect(screen.getByText(/two_tower_retrieval/)).toBeInTheDocument()
    expect(screen.getByText(/Recall@K と NDCG/)).toHaveTextContent('人気順と比べる')
    expect(screen.getByText(/推論に使う一式を実験の inference\/ に作る/)).toHaveTextContent(
      'README.md の最後の一覧を直すまで問題の設定はつながない',
    )
    // 列の予測の手順と, 他の型の inference/ の登録は出さない
    expect(screen.queryByText(/右の「データの分析」の値/)).toBeNull()
    expect(screen.queryByText(/inference\/ は登録できる/)).toBeNull()
    expect(screen.queryByText(/意思決定の既定値は付かない/)).toBeNull()
  })

  it('並べるで既製のモデルをそのまま使う答えは, 並べるの説明にしない', () => {
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'rank' }
    const method: Question = { ...KIND, id: 'ml.parts.0.method', value: 'pretrained' }
    renderDialog({ ...problemWith([]), questions: [{ ...KIND, applies: false }, role, method] })
    expect(screen.queryByText(/品物の列と受け持ちから/)).toBeNull()
  })

  it('まとめるは, まとめるの次にすることと群の数の実験の名前を出し, 損得と制約の注意を出さない', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'group' }
    const method: Question = { ...KIND, id: 'ml.parts.0.method', value: 'scratch' }
    const problem = problemWith([
      { level: 'error', id: 'action.decision.value', message: '数を答えてください' },
    ])
    renderDialog({ ...problem, questions: [{ ...KIND, applies: false }, role, method, OWNER] })
    expect(screen.getByText(/受け持ちと群の数から/)).toBeInTheDocument()
    expect(screen.getByText(/群を作る表とモデルの定義を置いて学習します/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /それでも書き出す/ }))
    fireEvent.click(screen.getByRole('button', { name: '直すところが残ったまま書き出す' }))
    expect(await screen.findByText(/群を作る表 \(1 行が 1 つの対象/)).toBeInTheDocument()
    expect(screen.getByText(/contrastive_encoder/)).toBeInTheDocument()
    expect(screen.getByText(/群のまとまり \(大きいほど良い\)/)).toHaveTextContent('群の要約')
    expect(screen.getByText(/推論の一式は作らない/)).toHaveTextContent(
      'README.md の最後の一覧を直すまで問題の設定はつながない',
    )
    // 列の予測の手順と, 他の型の inference/ の登録は出さない
    expect(screen.queryByText(/右の「データの分析」の値/)).toBeNull()
    expect(screen.queryByText(/inference\/ は登録できる/)).toBeNull()
    expect(screen.queryByText(/意思決定の既定値は付かない/)).toBeNull()
  })

  it('異常の検知は, 正解の有る無しと度合いの決め方に合う次にすることと実験の名前を出す', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'predict' }
    const method: Question = { ...KIND, id: 'ml.parts.0.method', value: 'scratch' }
    const kind: Question = { ...KIND, value: 'anomaly' }
    const source: Question = { ...KIND, id: 'ml.parts.0.target.source', value: 'few' }
    const score: Question = { ...KIND, id: 'ml.parts.0.anomaly.score', value: 'autoencoder' }
    const problem = problemWith([])
    const { unmount } = renderDialog({
      ...problem,
      questions: [kind, role, method, source, score, OWNER],
    })
    expect(screen.getByText(/受け持ちと度合いの決め方から/)).toBeInTheDocument()
    expect(screen.getByText(/異常の検知の表とモデルの定義を置いて学習します/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    expect(await screen.findByText(/異常の検知の表をデータセットの書き出し先/)).toHaveTextContent(
      '学習用は正常の行だけ',
    )
    expect(screen.getByText(/tabular_autoencoder/)).toBeInTheDocument()
    expect(screen.getByText(/上位 K 件の適合率と PR-AUC/)).toBeInTheDocument()
    expect(screen.getByText(/異常の度合いの一式/)).toHaveTextContent('仮のモデルでは作らない')
    expect(screen.getByText(/異常の度合いの一式/)).toHaveTextContent('件数の上限まで人の確認')
    expect(screen.queryByText(/右の「データの分析」の値/)).toBeNull()
    unmount()

    // 正解が無く距離なら, 学習せず, 度合いの分布と上位の行の要約で見る
    renderDialog({
      ...problem,
      questions: [
        kind,
        role,
        method,
        { ...source, value: 'none' },
        { ...score, value: 'distance' },
        OWNER,
      ],
    })
    expect(screen.getByText(/度合いを数えます \(学習はしません\)/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }))
    expect(await screen.findByText(/モデルの定義は要らない/)).toBeInTheDocument()
    expect(screen.getByText(/度合いの分布と上位 K 行の要約/)).toBeInTheDocument()
    expect(screen.queryByText(/tabular_autoencoder/)).toBeNull()
    expect(screen.getByText(/異常の度合いの一式/)).not.toHaveTextContent('仮のモデル')
  })

  it('効果の見積もりは, 介入の記録の表の次にすることと実験の名前と, 配る数の上限の注意を出す', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'effect' }
    const method: Question = { ...KIND, id: 'ml.parts.0.method', value: 'scratch' }
    const autonomous: Question = {
      ...KIND,
      id: 'ml.parts.0.autonomous',
      kind: 'boolean',
      value: false,
    }
    const collect: Question = { ...KIND, id: 'ml.parts.0.collect', value: 'log' }
    const problem = problemWith([
      { level: 'error', id: 'action.decision.budget', message: '1 以上の整数で答えてください' },
    ])
    const { unmount } = renderDialog({
      ...problem,
      questions: [{ ...KIND, value: null }, role, method, autonomous, collect, OWNER],
    })
    expect(screen.getByText(/結果の列と受け持ちから/)).toBeInTheDocument()
    expect(screen.getByText(/介入の記録の表とモデルの定義を置いて/)).toBeInTheDocument()
    expect(screen.getByText(/配る数の上限を付けずに/)).toBeInTheDocument()
    expect(screen.queryByText(/意思決定の既定値を付けずに/)).toBeNull()
    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
      target: { value: '/x' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /それでも書き出す/ }))
    fireEvent.click(screen.getByRole('button', { name: '直すところが残ったまま書き出す' }))
    expect(await screen.findByText(/介入の記録の表をデータセットの書き出し先/)).toHaveTextContent(
      '無作為に配った記録を前提にする',
    )
    expect(screen.getByText(/tabular_uplift/)).toBeInTheDocument()
    expect(screen.getByText(/Qini の曲線/)).toHaveTextContent('上位 K 割の効果の差')
    expect(screen.getByText(/Qini の曲線/)).toHaveTextContent('でたらめに配るよりどれだけ良いか')
    expect(screen.getByText(/介入の記録の表をデータセットの書き出し先/)).toHaveTextContent(
      '種類の列は one_hot で数の列にする',
    )
    expect(screen.getByText(/uplift_estimator\.json/)).toHaveTextContent(
      '効果の高い順に配る数の上限まで',
    )
    expect(screen.getByText(/uplift_estimator\.json/)).toHaveTextContent(
      '配る数の上限は空 (config の uplift.budget) のまま',
    )
    expect(screen.queryByText(/右の「データの分析」の値/)).toBeNull()
    expect(screen.queryByText(/意思決定の既定値は付かない/)).toBeNull()
    unmount()

    // 方策と答えると, 効果の見積もりの説明にしない
    renderDialog({
      ...problemWith([]),
      questions: [
        { ...KIND, value: null },
        role,
        method,
        { ...autonomous, value: true },
        { ...collect, value: 'simulator' },
        OWNER,
      ],
    })
    expect(screen.queryByText(/介入の記録の表/)).toBeNull()
    expect(screen.getByText(/環境と守りを整えて方策を学習します/)).toBeInTheDocument()
  })

  it('まとめるで既製のモデルをそのまま使う答えは, まとめるの説明にしない', () => {
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'group' }
    const method: Question = { ...KIND, id: 'ml.parts.0.method', value: 'pretrained' }
    renderDialog({ ...problemWith([]), questions: [{ ...KIND, applies: false }, role, method] })
    expect(screen.queryByText(/受け持ちと群の数から/)).toBeNull()
  })

  it('既製のモデルは, 一式づくりの次にすることを出し, 学習の言葉を出さない', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['bundle.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const method: Question = { ...KIND, id: 'ml.parts.0.method', value: 'pretrained' }
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'predict' }
    renderDialog({
      ...problemWith([]),
      questions: [{ ...KIND, value: 'image' }, role, method, OWNER],
    })
    expect(screen.getByText(/学習はしません/)).toBeInTheDocument()
    expect(screen.getByText(/モデルと重みの名前から/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /bundle\.py/ })).toBeInTheDocument()
    expect(screen.queryByText(/train\.py/)).toBeNull()

    fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), { target: { value: '/x' } })
    fireEvent.click(screen.getByRole('button', { name: /書き出す/ }))
    expect(await screen.findByText(/bundle\.py を動かす/)).toBeInTheDocument()
    expect(screen.getByText(/ready\.sha256/)).toBeInTheDocument()
  })

  it('既製のモデルの答えが残っても, 予測するでなければ既製の案内にしない', () => {
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'generate' }
    const method: Question = { ...KIND, id: 'ml.parts.0.method', value: 'pretrained' }
    const base = problemWith([])
    // 受け持ちが予測するでない (作り方の答えは残るだけ)
    const { unmount } = renderDialog({ ...base, questions: [KIND, role, method, OWNER] })
    expect(screen.queryByText(/学習はしません/)).toBeNull()
    unmount()
    // 作り方の問いが無効 (applies が偽)
    const predict: Question = { ...role, value: 'predict' }
    renderDialog({
      ...base,
      questions: [KIND, predict, { ...method, applies: false }, OWNER],
    })
    expect(screen.queryByText(/学習はしません/)).toBeNull()
  })

  it('方策は, 環境と守りと学習の次にすることを出し, 損得と制約の注意を出さない', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ path: '/x', files: ['train.py'], project: { path: '/x' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const role: Question = { ...KIND, id: 'ml.parts.0.role', value: 'effect' }
    const autonomous: Question = {
      ...KIND,
      id: 'ml.parts.0.autonomous',
      kind: 'boolean',
      value: true,
    }
    const env = (value: string | null): Question => ({
      ...KIND,
      id: 'ml.parts.0.env_id',
      kind: 'text',
      required: false,
      value,
    })
    const problem = problemWith([
      { level: 'error', id: 'action.decision.value', message: '数を答えてください' },
    ])
    const write = async () => {
      fireEvent.change(screen.getByLabelText(/書き出すディレクトリ/), {
        target: { value: '/x' },
      })
      fireEvent.click(screen.getByRole('checkbox', { name: /それでも書き出す/ }))
      fireEvent.click(screen.getByRole('button', { name: '直すところが残ったまま書き出す' }))
      await screen.findByRole('button', { name: '書き出しました' })
    }

    // 環境の登録名を答えていれば, その環境を使う
    const { unmount } = renderDialog({
      ...problem,
      questions: [role, autonomous, env('CartPole-v1'), OWNER],
    })
    expect(screen.getByText(/環境の登録名か env から/)).toBeInTheDocument()
    expect(screen.getByText(/環境と守りを整えて方策を学習します/)).toHaveTextContent(
      'model.py, 登録名が無ければ自作の環境の env.py',
    )
    expect(screen.getByText(/を上書きする/)).toHaveTextContent(
      'train.py, model.py, env.py, 入れたデータの写しの data/)',
    )
    expect(screen.queryByText(/既定値を付けずに/)).toBeNull()
    await write()
    expect(screen.getByText(/Gymnasium の CartPole-v1 \(config の env\.id\)/)).toBeInTheDocument()
    expect(screen.getByText(/config の guards に/)).toBeInTheDocument()
    // 方策の骨組みはデータセットとモデルの定義の置き場を持たない (空の場所を出さない)
    expect(screen.getByText(/この場所を問題の設定に記録しました/)).toHaveTextContent(
      'この場所を問題の設定に記録しました (後ろの段階のアプリ',
    )
    expect(screen.queryByText(/データセットは/)).toBeNull()
    expect(screen.getByText(/policy\/ に守りと一緒に/)).toHaveTextContent(
      'README.md の最後の一覧を直すまで問題の設定はつながない',
    )
    expect(screen.queryByText(/意思決定の既定値は付かない/)).toBeNull()
    unmount()

    // 答えていなければ, 自作の環境の雛形を書き換える
    renderDialog({ ...problem, questions: [role, autonomous, env(null), OWNER] })
    await write()
    expect(screen.getByText(/自作の環境の雛形 env\.py \(ProjectEnv\)/)).toBeInTheDocument()
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
