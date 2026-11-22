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
})
