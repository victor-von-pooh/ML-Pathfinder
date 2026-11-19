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
