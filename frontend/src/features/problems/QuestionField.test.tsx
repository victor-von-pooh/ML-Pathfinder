import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Question } from '../../api/types'
import { QuestionField } from './QuestionField'

/** 受け持ちで絞られた出力の形の問い (保存した答えは今の選択肢に無い) */
const OUTPUT: Question = {
  id: 'ml.parts.0.output',
  section: 5,
  kind: 'choice',
  title: '出力の形は',
  help: '',
  required: true,
  choices: [{ value: 'ranking', label: '順位' }],
  value: 'shape',
  answered: true,
  applies: true,
  multiline: false,
}

describe('QuestionField', () => {
  it('今の選択肢に無い答えは印を付けて出し, 外せる', () => {
    const onAnswer = vi.fn()
    render(
      <QuestionField
        question={OUTPUT}
        columns={[]}
        findings={[]}
        saving={false}
        error={null}
        onAnswer={onAnswer}
      />,
    )
    expect(screen.getByLabelText(/shape \(今の答えに合いません/)).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '答えを外す' }))
    expect(onAnswer).toHaveBeenCalledWith(null)
  })

  it('文の問いは, 問いの欄の形 (multiline) で 1 行の欄か複数行の欄にする', () => {
    const text = (id: string, multiline: boolean): Question => ({
      id,
      section: 5,
      kind: 'text',
      title: id,
      help: '',
      required: false,
      choices: [],
      value: null,
      answered: false,
      applies: true,
      multiline,
    })
    const props = { columns: [], findings: [], saving: false, error: null, onAnswer: vi.fn() }
    // 欄の形は問いの名前でなく multiline で決まる
    const { rerender } = render(
      <QuestionField question={text('ml.parts.0.what', false)} {...props} />,
    )
    expect(screen.getByRole('textbox').tagName).toBe('INPUT')
    rerender(<QuestionField question={text('ml.parts.0.env_id', true)} {...props} />)
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA')
  })

  it('手元のデータの場所が誤っている間も, 欄に誤りを出して外せる', () => {
    const onDetach = vi.fn()
    vi.stubGlobal('confirm', () => true)
    const source: Question = {
      id: 'data.source',
      section: 5,
      kind: 'source',
      title: '手元のデータは',
      help: '',
      required: false,
      choices: [],
      value: 123,
      answered: true,
      applies: true,
      multiline: false,
    }
    const props = { columns: [], saving: false, error: null, onAnswer: vi.fn(), onDetach }
    const broken = { level: 'error' as const, id: 'data.source', message: '場所の形の誤り' }
    const { rerender } = render(
      <QuestionField question={source} findings={[broken]} onAttach={vi.fn()} {...props} />,
    )
    expect(screen.getByText(/場所が誤っています/)).toBeInTheDocument()
    expect(screen.getByText(/場所の形の誤り/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'データを入れ直す' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'データを外す' }))
    expect(onDetach).toHaveBeenCalled()

    // 誤りが無く入れていなければ, 外す道は出さない
    rerender(
      <QuestionField
        question={{ ...source, value: null, answered: false }}
        findings={[]}
        onAttach={vi.fn()}
        {...props}
      />,
    )
    expect(screen.getByText('入れていません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'データを外す' })).not.toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('1 行の欄は, 前の答えの改行を空白にして出し, 直すと空白のまま保存する', () => {
    const onAnswer = vi.fn()
    const owner: Question = {
      id: 'issue.owner',
      section: 1,
      kind: 'text',
      title: '誰の課題ですか',
      help: '',
      required: true,
      choices: [],
      value: '店長\n副店長',
      answered: true,
      applies: true,
      multiline: false,
    }
    const props = { columns: [], findings: [], saving: false, error: null, onAnswer }
    const { rerender } = render(<QuestionField question={owner} {...props} />)
    const box = screen.getByRole('textbox')
    expect(box).toHaveValue('店長 副店長')
    // 直さずに離れると保存しない
    fireEvent.blur(box)
    expect(onAnswer).not.toHaveBeenCalled()
    fireEvent.change(box, { target: { value: '店長 副店長 と本部' } })
    fireEvent.blur(box)
    expect(onAnswer).toHaveBeenCalledWith('店長 副店長 と本部')

    // 複数行の欄は改行のまま出す
    rerender(
      <QuestionField question={{ ...owner, id: 'issue.pain', multiline: true }} {...props} />,
    )
    expect(screen.getByRole('textbox')).toHaveValue('店長\n副店長')
  })

  it('任意のはいかいいえの問いは, 答えた後に外せる (答えていなければ出さない)', () => {
    const onAnswer = vi.fn()
    const gpu: Question = {
      id: 'ml.gpu',
      section: 7,
      kind: 'boolean',
      title: 'GPU (CUDA) が要りますか',
      help: '',
      required: false,
      choices: [],
      value: true,
      answered: true,
      applies: true,
      multiline: false,
    }
    const props = { columns: [], findings: [], saving: false, error: null, onAnswer }
    const { rerender } = render(<QuestionField question={gpu} {...props} />)
    expect(screen.getByLabelText('はい')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '答えを外す' }))
    expect(onAnswer).toHaveBeenCalledWith(null)
    rerender(<QuestionField question={{ ...gpu, value: null, answered: false }} {...props} />)
    expect(screen.queryByRole('button', { name: '答えを外す' })).not.toBeInTheDocument()
  })

  it('今のやり方の書き方は問いの選択肢と欄で描き, 使えない保存した書き方は印を付けて残す', () => {
    const onAnswer = vi.fn()
    const periods = [{ key: 'periods', label: '期の数 k (1 以上の整数)', required: true }]
    const baseline: Question = {
      id: 'action.current',
      section: 7,
      kind: 'baseline',
      title: '今のやり方をデータで書くと',
      help: '',
      required: false,
      choices: [
        { value: 'lag', label: 'k 期前と同じ', fields: periods },
        {
          value: 'column',
          label: '今のやり方の値の列',
          fields: [{ key: 'column', label: '今のやり方の値の列', required: true }],
        },
      ],
      value: { type: 'lag', periods: 7 },
      answered: true,
      applies: true,
      multiline: false,
    }
    const props = { columns: [], findings: [], saving: false, error: null, onAnswer }
    const { rerender } = render(<QuestionField question={baseline} {...props} />)
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('lag')
    // 期の数の欄の名前は ML-Quest の欄から. 変えると保存できる
    const box = screen.getByLabelText('期の数 k (1 以上の整数)')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.change(box, { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onAnswer).toHaveBeenCalledWith({ type: 'lag', periods: '14' })

    // 選ぶと振り分けの型では lag は選択肢に無い. 保存した値は「(使えません)」で残す
    rerender(
      <QuestionField
        question={{
          ...baseline,
          value: { type: 'lag', periods: 3 },
          choices: baseline.choices.slice(1),
        }}
        {...props}
      />,
    )
    expect(screen.getByRole('option', { name: 'lag (使えません)' })).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('lag')
    expect(screen.getByText(/今の意思決定の型では使えません/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'column' } })
    expect(screen.getByLabelText('今のやり方の値の列')).toBeInTheDocument()
  })
})
