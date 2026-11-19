import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { FeatureRequirement } from '../../api/types'
import { RequiresCard } from './RequiresCard'

/** ML-Found の登録簿から入れ方が分かった機能 */
const RL: FeatureRequirement = {
  name: 'rl',
  label: '強化学習 (環境とのやり取り. Gymnasium)',
  description: '強化学習の環境',
  install: {
    kind: 'pip',
    command: 'pip install "gymnasium>=1.0"',
    extra_command: 'pip install -e "./ML-Found[rl]"',
    url: 'https://gymnasium.farama.org/',
  },
  note: null,
  source: 'ml_found',
}

describe('RequiresCard', () => {
  it('要る機能が無ければ出さない', () => {
    const { container } = render(<RequiresCard requires={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('pip のコマンド, 公式の手順, ML-Found が無いときの補足を出す', () => {
    const items: FeatureRequirement[] = [
      RL,
      {
        name: 'ros2',
        label: 'ROS2 (機械とのやり取り)',
        description: null,
        install: {
          kind: 'guide',
          command: null,
          extra_command: null,
          url: 'https://docs.ros.org/',
        },
        note: 'pip では入らない',
        source: 'ml_found',
      },
      {
        name: 'cuda',
        label: 'CUDA (GPU で学習)',
        description: null,
        install: null,
        note: '学習の環境で登録簿を見る',
        source: 'ml_quest',
      },
    ]
    render(<RequiresCard requires={items} />)
    expect(screen.getByRole('heading', { name: /学習の段階の準備/ })).toBeInTheDocument()
    expect(screen.getByText(/このまま続けられます/)).toBeInTheDocument()
    expect(screen.getByText('pip install "gymnasium>=1.0"')).toBeInTheDocument()
    expect(screen.getByText('pip install -e "./ML-Found[rl]"')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /公式の手順/ })).toHaveAttribute(
      'href',
      'https://docs.ros.org/',
    )
    expect(screen.getByText('学習の環境で登録簿を見る')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})
