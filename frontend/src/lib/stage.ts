import { createContext, useContext } from 'react'

/** 段階の鍵 (殻の段階の並びと同じ) */
export type StageKey = 'problem' | 'data' | 'model' | 'train' | 'infer'

/** 段階の名前 (殻の言葉の表の名前) */
export const STAGE_NAMES: Record<StageKey, string> = {
  problem: '問題の設定',
  data: 'データの分析',
  model: 'モデルの作成・選定',
  train: '学習・評価',
  infer: '推論',
}

/** 根の部品が受け取った, 殻とのやり取り (単独では選びを持たず, 知らせはどこにも届かない) */
export interface StageValue {
  /** 殻で選んだ問題の設定の識別子 (null は選んでいない) */
  project: string | null
  /** 部品の中で問題の設定を開いたか消したときに呼ぶ */
  onProjectChange: (project: string | null) => void
  /** 問題の一覧が変わった (作った, 名前を変えた, 消した) ときに呼ぶ */
  onProjectsChange: () => void
  /** 殻の下に載せたか (アプリの名前と明暗の切り替えを出さない) */
  embedded: boolean
  /** 段階をまたいで移ってほしいときに呼ぶ (単独では無い) */
  onStageChange?: (stage: StageKey) => void
  /** 次の段階の行き先 (null は後ろに要る段階が無い. 単独では無い) */
  nextStage?: StageKey | null
  /** 段階の物が変わったときに呼ぶ (単独では何もしない) */
  onProgressChange: () => void
}

export const StageContext = createContext<StageValue>({
  project: null,
  onProjectChange: () => {},
  onProjectsChange: () => {},
  embedded: false,
  onProgressChange: () => {},
})

/** 根の部品が受け取った, 殻とのやり取りを使う */
export function useStage(): StageValue {
  return useContext(StageContext)
}
