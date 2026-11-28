import { createContext, useContext } from 'react'

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
}

export const StageContext = createContext<StageValue>({
  project: null,
  onProjectChange: () => {},
  onProjectsChange: () => {},
  embedded: false,
})

/** 根の部品が受け取った, 殻とのやり取りを使う */
export function useStage(): StageValue {
  return useContext(StageContext)
}
