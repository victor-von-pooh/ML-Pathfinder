/** ディレクトリの中身の 1 件 */
export interface Entry {
  name: string
  path: string
  is_dir: boolean
  size: number | null
  /** ML-Found のプロジェクトのディレクトリか */
  project: boolean
}

/** ディレクトリの中身 */
export interface Listing {
  path: string
  parent: string | null
  home: string
  entries: Entry[]
  truncated: boolean
}

/** 問いの種類 */
export type QuestionKind =
  | 'text'
  | 'number'
  | 'choice'
  | 'boolean'
  | 'column'
  | 'columns'
  | 'list'
  | 'levers'
  | 'decision'
  | 'source'

/** 選択肢 */
export interface Choice {
  value: string
  label: string
}

/** 要因と打てる手の 1 行 */
export interface Lever {
  cause: string
  lever: string
  ml: boolean
}

/** 意思決定の型と損得と制約 (ML-Inference の形. 値は数か列の名前) */
export interface Decision {
  type: 'quantity' | 'select' | 'triage' | 'none'
  [field: string]: string | number | undefined
}

/** 問い (今の答え, 答えたか, 今要るかを含む) */
export interface Question {
  id: string
  section: number
  kind: QuestionKind
  title: string
  help: string
  required: boolean
  choices: Choice[]
  value: unknown
  answered: boolean
  applies: boolean
}

/** 確かめの 1 件 */
export interface Finding {
  level: 'error' | 'warning' | 'info'
  id: string
  message: string
}

/** 節ごとの進み具合 */
export interface SectionProgress {
  number: number
  title: string
  answered: number
  required: number
}

/** 進み具合 */
export interface Progress {
  answered: number
  required: number
  sections: SectionProgress[]
}

/** 後ろの段階ごとの値 */
export interface Handoff {
  data: {
    target: string
    task: string
    time_column: string | null
    series_by: string[]
    split: string
    /** 過去の値の列に使ってよい最も小さいずらし幅 (時系列の予測だけ) */
    min_lag: number | null
    known: string[]
    drop: string[]
    /** データの場所と ML-EDA の読み方 (入れていなければ null) */
    source: {
      source: string
      loader: string | null
      options: Record<string, unknown> | null
    } | null
  }
  model: { task: string; outputs: number | null }
  training: { metric: string; monitor: string; mode: string }
  inference: {
    decision: Decision | null
    conclusion: Record<string, unknown>
    horizon: number | null
  }
}

/** 問題の設定の全て */
export interface Problem {
  id: string
  name: string
  created_at: string | null
  updated_at: string | null
  uses_ml: boolean | null
  questions: Question[]
  progress: Progress
  findings: Finding[]
  summary: string[]
  handoff: Handoff | null
  handoff_error: string | null
  ready: boolean
  finished: boolean
}

/** 一覧の 1 行 */
export interface ProblemItem {
  id: string
  name: string
  updated_at: string | null
  uses_ml: boolean | null
  progress: Progress
  ready: boolean
  finished: boolean
  errors: number
}

/** 節, 見本の名前 */
export interface Info {
  format_version: number
  sections: { number: number; title: string }[]
  examples: string[]
}

/** 骨組みの書き出しの結果 */
export interface ProjectResult {
  path: string
  files: string[]
}

/** データからの答えの候補 */
export interface Suggestion {
  id: string
  values: string[]
  reason: string
}

/** 入れたデータからの概要, 答えの候補, 確かめ */
export interface Insight {
  overview: {
    rows: number
    columns: number
    kind: string
    /** 大きなデータを見本の行で分析したか */
    sampled: boolean | null
    sample_rows: number | null
    start: string | null
    end: string | null
    interval_seconds: number | null
  } | null
  suggestions: Suggestion[]
  findings: Finding[]
}
