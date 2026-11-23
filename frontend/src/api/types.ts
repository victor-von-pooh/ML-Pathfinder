/** ディレクトリの中身の 1 件 */
export interface Entry {
  name: string
  path: string
  is_dir: boolean
  size: number | null
  /** ML-Found のプロジェクトのディレクトリか */
  project: boolean
  /** ML-EDA のデータセットのディレクトリ (dataset.yaml を持つ) か */
  dataset: boolean
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
  | 'baseline'

/** 選択肢 */
export interface Choice {
  value: string
  label: string
  /** 相手をまとめる列の同じ値を同じ分割に入れるか (受け渡しの分割の名前だけ. ML-Quest の SPLITS の grouped) */
  grouped?: boolean
  /** 意思決定の型の欄 (意思決定の問いの選択肢だけ) */
  fields?: DecisionField[]
}

/** 意思決定の欄 (ML-Quest が返す. 名前, 説明, 要るか, 選んで書くなら選択肢) */
export interface DecisionField {
  key: string
  label: string
  required: boolean
  choices?: Choice[]
  /** 選ばないときの意味 */
  unset?: string
  /** 他の欄の値で要るかが決まる */
  when?: { key: string; equals: string }
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
  /** 複数行の欄で答えるか (ML-Quest の問いの欄の形. 文の問いだけ真になりうる) */
  multiline: boolean
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

/** 機械学習の受け持ちの, 型に依らない答え (ML-Quest の版 2) */
export interface Part {
  role: string | null
  unit: string | null
  output: string | null
  target_kind: string | null
  target_source: string | null
  /** 正解が今の処理の出力なら, その処理の名前と設定 */
  target_process: { name: string; settings: string | null } | null
  method: string | null
}

/** 方策の守り (効果を見積もるで方策と答えたときだけ. ML-Found の make_guards と同じ名前) */
export interface Policy {
  /** 行動の上限 (文. 学習の段階で数にする) */
  action_limits: string | null
  /** 1 歩ごとに方策の出力を止める条件 (文) */
  stop: string | null
  /** 外れたときの動き (stop, handover, action) */
  fallback: string | null
  /** fallback が action のときの決めた行動 */
  fallback_action: string | number | number[] | null
  /** 安全の違反の信号の名前 (答えていなければ cost) */
  safety_key: string | null
  /** 方策を使ってよいかと守りの範囲を決める人 */
  approver: string | null
  /** Gymnasium の環境の登録名 (答えていなければ null. 骨組みは自作の環境の雛形を書き出す) */
  env_id: string | null
}

/** 要る機能の入れ方 (ML-Found の登録簿 describe_requirements から) */
export interface FeatureInstall {
  /** pip で入るか, 公式の手順に従うか */
  kind: 'pip' | 'guide' | null
  command: string | null
  /** ML-Found の追加の依存として入れるコマンド */
  extra_command: string | null
  url: string | null
}

/** 要る機能 1 つ (ML-Quest の required_features. 受け渡しの前から出る) */
export interface FeatureRequirement {
  name: string
  /** ML-Quest の FEATURES の名前 */
  label: string
  description: string | null
  /** 入れ方 (ML-Found が無ければ null) */
  install: FeatureInstall | null
  note: string | null
  /** 入れ方の出どころ */
  source: 'ml_found' | 'ml_quest'
}

/** 後ろの段階ごとの値 (列の予測でなければ, data の目的の列, タスク, 分割は null) */
export interface Handoff {
  part: Part
  data: {
    target: string | null
    task: string | null
    time_column: string | null
    series_by: string[]
    split: string | null
    /** 同じ相手の行をまとめる列 (分割をまたがせない) */
    group_column?: string | null
    /** ファイルの組の受け持ちで, 件の id ごとのグループの名前 (無ければ null) */
    groups?: Record<string, string> | null
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
    /** 書き出したプロジェクトのデータセットの置き場 (絶対パス. 書き出していなければ null) */
    project_dataset?: string | null
  }
  model: {
    task: string | null
    outputs: number | null
    role: string | null
    target_kind: string | null
    /** 受け持ちに合うモデルの作成の雛形 (ML-ModelControl の同梱の例の名前. 一から学習しないか, 合う例が無ければ null) */
    example: string | null
    /** 書き出したプロジェクトのモデルの定義の置き場 (絶対パス. 書き出していなければ null) */
    project_model_spec?: string | null
  }
  /** metric は最良を選ぶ指標 (その他なら書いた名前). 既製のモデルをそのまま使う (学習しない) なら 3 つとも null */
  training: {
    metric: string | null
    monitor: string | null
    mode: string | null
    role: string | null
    target_kind: string | null
  }
  inference: {
    decision: Decision | null
    conclusion: Record<string, unknown>
    horizon: number | null
    /** 既製のモデルをそのまま使うときの一式づくりの値 (使わなければ null) */
    ready: ReadyModel | null
  }
  /** 要る機能の名前 (ML-Quest の FEATURES) */
  requires: string[]
  /** 方策の守り (方策でなければ null) */
  policy: Policy | null
  /** 書き出したプロジェクト (書き出していなければ path は null) */
  project?: { path: string | null }
}

/** 既製のモデルの出どころと名前 (sha256 は決めていなければ null) */
export interface ReadyModel {
  library: string | null
  model: string | null
  weights: string | null
  sha256: string | null
}

/** 書き出した学習のプロジェクトの記録 (ML-Quest の record_project. どれも絶対パス) */
export interface ProjectRecord {
  path: string | null
  /** train.py がデータセットを読む場所 (config の data.dataset) */
  dataset: string | null
  /** train.py がモデルの定義を読む場所 (config の model.spec. 書いていなければ null) */
  model_spec: string | null
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
  /** 要る機能と入れ方 (答えの途中から. 学習の段階の準備) */
  requires: FeatureRequirement[]
  ready: boolean
  /**
   * 学習のプロジェクトの骨組みを組めるか (機械学習を使い, 骨組みを組めない直すところが無く,
   * 列の予測か, 予測するの画像の領域と点群で, 指標がその他でなく, 入れたデータセットが受け持ちに
   * 合う. 決まりは ML-Quest の project_error. 受け渡せるかは条件にしない)
   */
  exportable: boolean
  /** 骨組みを組めない理由 (ML-Quest の project_error の文) */
  export_error: string | null
  /**
   * 書き出すときに残っている直すところ (ML-Quest の open_errors. 問題の設定の確かめと入れた
   * データの確かめの error. 書き出せないときは空). 残っていれば「それでも書き出す」の確かめが要る
   */
  open_errors: Finding[]
  /** 書き出した学習のプロジェクト (書き出していなければ null) */
  project?: ProjectRecord | null
  finished: boolean
  /** ファイルに書いてある版 (古い版は ML-Quest が移して読み, 次の保存で今の版に) */
  file_version: number | null
  /** 問題の設定のファイルの中身の印 (他のアプリが書き換えたことに気付くため) */
  version: string
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
  /** 受け渡しの分割の値と説明 (ML-Quest の SPLITS) */
  splits: Choice[]
  /** 意思決定の型ごとの, 幅を渡せる損得と制約の項目 (ML-Quest の SENSITIVITY_FIELDS) */
  sensitivity_fields: Record<string, string[]>
  /** 振り分けのやり方の名前 (損得の値の幅の結果の best. ML-Quest の損得の値の幅) */
  sensitivity_plans: Record<string, string>
}

/** 骨組みの書き出しの結果 */
export interface ProjectResult {
  path: string
  files: string[]
  /** 問題の設定に保存したプロジェクトの記録 */
  project: ProjectRecord
}

/** データからの答えの候補 */
export interface Suggestion {
  id: string
  values: string[]
  reason: string
}

/**
 * 入れたデータからの概要, 答えの候補, 確かめ (ML-EDA の版 2 のデータセットは表でないので,
 * 概要は null で, 件数と正解の種類, 合わない理由, 検証用の分割が無いことを確かめで知らせる)
 */
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
  /** 今のやり方の損か得 (書いていなければ null) */
  baseline?: { kind: string; total: number; per_30_days: number | null; sentence: string } | null
}

/** 振り分けのやり方 (今のやり方と, 予測の要らない素朴なやり方) */
export type TriagePlan = 'current' | 'none' | 'all'

/** 1 つの損得の値の組での結論 (ML-Quest の decision_sensitivity) */
export interface SensitivityOutcome {
  /** 決め方の値 (列で書いた値があれば null) */
  rule: number | null
  /** 対象を選ぶ型で, 得になる対象がありうるか (対象を選ぶ型だけ) */
  acts?: boolean | null
  /** 件数の上限 (量を決める型には無い. 上限が無ければ null) */
  limit?: number | null
  /** データの上のやり方ごとの損 (求めなければ無い) */
  loss?: Partial<Record<TriagePlan, number>>
  per_30_days?: Partial<Record<TriagePlan, number>> | null
  /** 振り分けで損の最も小さいやり方 */
  best?: TriagePlan
}

/** 1 つの項目を幅の中で変えた結論 */
export interface SensitivityField {
  field: string
  label: string
  points: (SensitivityOutcome & { value: number })[]
  /** 決め方の値と今のやり方の損の振れ幅 (求めなければ null) */
  swing: { rule: number | null; loss: number | null }
  sentence: string
}

/** 損得の値の幅から求めた結論の変わり方 */
export interface Sensitivity {
  type: 'quantity' | 'select' | 'triage'
  /** 決め方の値の名前 */
  rule: string
  base: SensitivityOutcome
  fields: SensitivityField[]
  /** 損を求めた行の数と日数 (求めなければ null) */
  data: { rows: number; days: number | null } | null
  notes: string[]
}
