import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, useLocation, useNavigate } from 'react-router'

import { App } from './App'
import { ApiContext, ApiError, createApi } from './api/client'
import { StageContext, type StageKey, type StageValue } from './lib/stage'
import { ThemeProvider } from './lib/theme'

/** 問題の設定の段階の画面の根の部品の props (殻と単独で同じ形) */
export interface StageAppProps {
  /** 画面の経路の頭 (例 `/problem`). 単独では `""` */
  basename: string
  /** API の頭 (例 `/api/problem`). 単独では `/api` */
  apiBase: string
  /** 殻で選んだ問題の設定の識別子. null は選んでいない (一覧を出す) */
  project: string | null
  /** 部品の中で問題の設定を作ったか開いた (識別子), 消した (null) ときに呼ぶ */
  onProjectChange: (project: string | null) => void
  /** 問題の一覧が変わった (作った, 名前を変えた, 消した) ときに呼ぶ */
  onProjectsChange: () => void
  /** 殻の下に載せたか (アプリの名前と明暗の切り替えを出さず, 明暗は読むだけにする) */
  embedded: boolean
  /** 次の段階か戻る段階へのボタンで呼ぶ. 単独では渡さない (ボタンを出さずに文だけを出す) */
  onStageChange?: (stage: StageKey) => void
  /** 次の段階の行き先. null は後ろに要る段階が無い (ボタンを出さない). 単独では渡さない */
  nextStage?: StageKey | null
  /** 問題の設定の物を作る, 保存する, 書き出す, 消すときに呼ぶ. 単独では渡さない */
  onProgressChange?: () => void
}

/** 部品ごとの TanStack Query の client */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        // 誤りの応答などの利用者側のエラーは繰り返さない
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
      },
    },
  })
}

/** 問題の設定の画面の経路 (basename を除いた形) */
const problemPath = (id: string) => `/problems/${encodeURIComponent(id)}`

/**
 * 受け取った project に合わせて経路を移す
 *
 * 履歴は増やさず置き換える (殻が URL の検索の引数に問題を持つので, 戻る・進むで余分な履歴を作らないため).
 * project が変わったときだけ移す (部品の中の移動で殻の選びに引き戻さないため). 単独で最初に
 * null を受け取ったときは, 開いた URL のまま (直に開いた問題の設定を一覧に替えないため)
 */
function FollowProject({ project, embedded }: { project: string | null; embedded: boolean }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  // 経路は移動のたびに変わるので, 移すかを決めるときだけ読む
  const path = useRef(pathname)
  useLayoutEffect(() => {
    path.current = pathname
  }, [pathname])
  // 前に合わせた値 (undefined はまだ合わせていない. StrictMode の 2 度の実行でも 1 度だけ移す)
  const followed = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (followed.current === project) return
    const first = followed.current === undefined
    followed.current = project
    if (project === null && first && !embedded) return
    const target = project === null ? '/' : problemPath(project)
    if (path.current !== target) void navigate(target, { replace: true })
  }, [project, embedded, navigate])
  return null
}

/**
 * 問題の設定の段階の画面の根の部品
 *
 * 自分のルーター (basename の下) と TanStack Query の client を持つ. 単独では main.tsx が
 * 既定の値 (basename `""`, apiBase `/api`, project null, embedded false) で描く
 */
export function StageApp({
  basename,
  apiBase,
  project,
  onProjectChange,
  onProjectsChange,
  embedded,
  onStageChange,
  nextStage,
  onProgressChange,
}: StageAppProps) {
  const [queryClient] = useState(makeQueryClient)
  const api = useMemo(() => createApi(apiBase), [apiBase])
  const stage = useMemo<StageValue>(
    () => ({
      project,
      onProjectChange,
      onProjectsChange,
      embedded,
      onStageChange,
      nextStage,
      onProgressChange: onProgressChange ?? (() => {}),
    }),
    [
      project,
      onProjectChange,
      onProjectsChange,
      embedded,
      onStageChange,
      nextStage,
      onProgressChange,
    ],
  )
  return (
    <ThemeProvider readOnly={embedded}>
      <QueryClientProvider client={queryClient}>
        <ApiContext.Provider value={api}>
          <StageContext.Provider value={stage}>
            <BrowserRouter basename={basename}>
              <FollowProject project={project} embedded={embedded} />
              {/* 段階の画面の範囲 (殻の R9. 箱を作らない) */}
              <div data-stage-root="" className="contents">
                <App />
              </div>
            </BrowserRouter>
          </StageContext.Provider>
        </ApiContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
