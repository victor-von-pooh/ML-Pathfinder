import { readFileSync, writeFileSync } from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

/** 選択肢の問いの 1 つを選び, 保存を待つ (問いの題で探す) */
async function choose(page: Page, title: string, label: string | RegExp) {
  await page.getByRole('radiogroup', { name: title, exact: true }).getByLabel(label).check()
  await expect(page.getByText(`「${title}」を保存しました`)).toBeVisible()
}

/** 文の問いに書き, 欄を離れて保存を待つ */
async function write(page: Page, title: string, text: string) {
  const box = page.getByRole('textbox', { name: title, exact: true })
  await box.fill(text)
  await box.blur()
  await expect(page.getByText(`「${title}」を保存しました`)).toBeVisible()
}

/** 5 の節の頭で, 表の列を予測すると答える (目的の列やタスクの問いが出る) */
async function answerColumnPart(page: Page) {
  await choose(page, '機械学習は何を受け持ちますか', /^予測する/)
  await choose(page, '正解 (出力) の種類は', /^表の列/)
}

// 作業用の置き場で, 見本を開き, 答えを変えて確かめが変わり, 骨組みを書き出す
test('見本を開いて答えを変え, 学習のプロジェクトを書き出す', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await expect(page.getByRole('heading', { name: '総菜の作る量' })).toBeVisible()
  await expect(page.getByText('食い違いや足りない答えはありません.')).toBeVisible()

  // タスクを分類に変えると, 量を決める行動と食い違う
  await page.getByRole('button', { name: /機械学習の受け持ち/ }).click()
  await page.getByRole('radio', { name: /分類/ }).check()
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText(
    '量を決めるには',
  )
  await expect(page.getByRole('button', { name: '学習のプロジェクトを書き出す' })).toBeDisabled()

  // 時系列の予測に戻すと書き出せる
  await page.getByRole('radio', { name: /時系列の予測/ }).check()
  await expect(page.getByText('食い違いや足りない答えはありません.')).toBeVisible()
  await page.getByRole('button', { name: '学習のプロジェクトを書き出す' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('書き出すディレクトリ (無ければ作る)')
    .fill(`${process.cwd()}/e2e/.work/project`)
  await dialog.getByRole('button', { name: '書き出す' }).click()
  await expect(dialog.getByRole('status')).toContainText('train.py')
})

test('新しく作って課題に答え, 一覧に進み具合が出る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('試しの問題')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '試しの問題' })).toBeVisible()
  const pain = page.getByRole('textbox', { name: '何に困っていますか' })
  await pain.fill('問い合わせが多い')
  await pain.blur()
  await expect(page.getByText('保存しました')).toBeVisible()
  await page.getByRole('link', { name: '問題の設定' }).first().click()
  await expect(page.getByRole('list', { name: '問題の設定' })).toContainText('試しの問題')
})

test('書きかけは節を移っても残り, 列の並びは 1 行に 1 つで答えられる', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('書きかけ')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '書きかけ' })).toBeVisible()

  // 3 の分解の書きかけを残して 2 へ移り, 戻る
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByLabel('要因 1').fill('勘で決める')
  await page.getByRole('button', { name: '前の節' }).click()
  await page.getByRole('button', { name: '次の節' }).click()
  await expect(page.getByLabel('要因 1')).toHaveValue('勘で決める')

  // 機械学習を使うと, 6 の列の問いが出る. 列の一覧が無くても 1 行に 1 つで答えられる
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByRole('radiogroup', { name: '機械学習を使いますか' }).getByLabel('はい').check()
  await expect(page.getByText('「機械学習を使いますか」を保存しました')).toBeVisible()
  // 6 の問いは, 受け持ちが表の列の予測のときだけ出る
  await answerColumnPart(page)
  await page.getByRole('button', { name: /^6\./ }).first().click()
  const known = page.getByRole('textbox', { name: '予測の時点で分かっている列は' })
  await known.fill('promo\nweather')
  await known.blur()
  await expect(page.getByText('「予測の時点で分かっている列は」を保存しました')).toBeVisible()
  await expect(known).toHaveValue('promo\nweather')
})

test('確かめから問いへ移ると, その入力に移る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('移る')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await page
    .getByRole('list', { name: '確かめ' })
    .getByRole('button', { name: /解けたと言える指標 の問いへ/ })
    .first()
    .click()
  await expect(page.getByRole('textbox', { name: '何が変われば解けたと言えますか' })).toBeFocused()
})

test('手元のデータを入れると, 答えの候補が出て押すと答えになる', async ({ page }) => {
  // 2 店の 60 日の売上と, 売上から作った客数
  const rows = ['date,shop,sales,customers']
  for (const shop of ['a', 'b'])
    for (let day = 0; day < 60; day++) {
      const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10)
      const sales = 50 + (day % 7) * 10
      rows.push(`${date},${shop},${sales},${sales * 3 + 1}`)
    }
  const file = `${process.cwd()}/e2e/.work/shop.csv`
  writeFileSync(file, rows.join('\n') + '\n')

  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('データ')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^5\b/ })
    .click()
  await choose(page, '機械学習を使いますか', 'はい')
  await answerColumnPart(page)
  await page.getByRole('button', { name: 'データを入れる' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('パス').fill(file)
  await dialog.getByRole('button', { name: '移動' }).click()
  await dialog.getByRole('button', { name: '選ぶ', exact: true }).click()
  await expect(page.getByText('120 行, 4 列')).toBeVisible()

  // 目的の列の候補を押すと答えになり, 漏れの疑いが確かめに出る
  await page.getByRole('button', { name: 'sales', exact: true }).click()
  await expect(page.getByText('「目的の列は」を保存しました')).toBeVisible()
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^6\b/ })
    .click()
  await expect(
    page
      .getByRole('list', { name: '確かめ', exact: true })
      .getByText(/customers は目的の列とほぼ同じ動き/),
  ).toBeVisible({ timeout: 20_000 })
})

test('今のやり方をデータで書くと, 損と指標の今の値の候補が出る', async ({ page }) => {
  // 総菜の見本と同じ列の 40 日 × 2 店 × 2 品 (曜日で決まる売れた数)
  const rows = ['date,store,item,sales,temperature_forecast,promo,customers']
  for (let day = 0; day < 40; day++) {
    const date = new Date(Date.UTC(2025, 0, 1 + day))
    for (const store of ['east', 'west'])
      for (const item of ['a', 'b']) {
        const sales = 10 + date.getUTCDay()
        rows.push(`${date.toISOString().slice(0, 10)},${store},${item},${sales},15,0,${sales * 3}`)
      }
  }
  const file = `${process.cwd()}/e2e/.work/sozai.csv`
  writeFileSync(file, rows.join('\n') + '\n')

  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  const nav = page.getByRole('navigation', { name: '問いの節' })
  await nav.getByRole('button', { name: /^5\b/ }).click()
  await page.getByRole('button', { name: 'データを入れる' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('パス').fill(file)
  await dialog.getByRole('button', { name: '移動' }).click()
  await dialog.getByRole('button', { name: '選ぶ', exact: true }).click()
  await expect(page.getByText('160 行, 7 列')).toBeVisible()

  // 7 の節で「1 日前と同じ」と書くと, 曜日の差の分の損が出る
  await nav.getByRole('button', { name: /^7\b/ }).click()
  await page.getByLabel('今のやり方をデータで書くと').selectOption('lag')
  await page.getByLabel(/k \(期の数/).fill('1')
  await page.getByRole('button', { name: '保存' }).last().click()
  await expect(page.getByText(/今のやり方の損は, 39 日で/).first()).toBeVisible({ timeout: 20_000 })

  // 2 の節の指標の今の値に, データからの候補が出る
  await nav.getByRole('button', { name: /^2\b/ }).click()
  await expect(page.getByRole('group', { name: /今のやり方の損をデータで求めた値/ })).toBeVisible()
})

test('問題の設定のファイルが他で変わると, 読み直して変わった問いの入力に出す', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('他で変わる')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '他で変わる' })).toBeVisible()
  const pain = page.getByRole('textbox', { name: '何に困っていますか' })
  await pain.fill('問い合わせが多い')
  await pain.blur()
  await expect(page.getByText('保存しました')).toBeVisible()

  // 別の問いは書きかけ (まだ欄を離れていない)
  const current = page.getByRole('textbox', { name: '今はどうしていますか' })
  await current.fill('前の週と同じ数')

  // 他のアプリ (ML-Fathom の書き戻しなど) がファイルを書き換えたとする
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const file = `${process.cwd()}/e2e/.work/home/problems/${id}/problem.yaml`
  writeFileSync(file, readFileSync(file, 'utf-8').replace('問い合わせが多い', '欠品が多い'))
  await expect(page.getByText(/他 \(ML-Fathom の書き戻しなど\) で変わったので/)).toBeVisible({
    timeout: 15_000,
  })
  await expect(pain).toHaveValue('欠品が多い')
  // 変わっていない問いの書きかけは残る
  await expect(current).toHaveValue('前の週と同じ数')
})

test('対象を選ぶ効果を確率の差で書くと, 向きの欄が出て, 保存すると食い違いが無い', async ({
  page,
}) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '解約の引き止め' }).click()
  await page.getByRole('button', { name: /損得と制約/ }).click()
  await expect(page.getByLabel(/当たりをどうしたいか/)).toHaveCount(0)
  await page.getByLabel(/効果の渡し方/).selectOption('uplift')
  await page.getByLabel(/^効果 \(/).fill('-0.1')
  await page.getByRole('button', { name: '保存' }).first().click()
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText(
    '向き (effect_goal',
  )
  await page.getByLabel(/当たりをどうしたいか/).selectOption('reduce')
  await page.getByRole('button', { name: '保存' }).first().click()
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).not.toContainText(
    'effect_goal',
  )
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText('無作為')
})

test('守る指標の名前を書くと, 向きと守る線の問いが出て, 筋道に出る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await page.getByRole('button', { name: /解けたと言える/ }).click()
  await expect(page.getByRole('textbox', { name: 'どこまでなら許せますか (守る線)' })).toHaveCount(
    0,
  )
  const name = page.getByLabel(/引き換えに悪くしてはいけない数字/)
  await name.fill('品切れした品と日の割合')
  await name.blur()
  await expect(page.getByRole('textbox', { name: 'どこまでなら許せますか (守る線)' })).toBeVisible()
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText('守る線')
  await page.getByRole('textbox', { name: 'どこまでなら許せますか (守る線)' }).fill('5')
  await page.getByRole('textbox', { name: 'どこまでなら許せますか (守る線)' }).blur()
  await page
    .getByRole('radiogroup', { name: /守る指標は, 小さいほど良いですか/ })
    .getByLabel('小さいほど良い')
    .check()
  await expect(page.getByText(/守る指標: 品切れした品と日の割合 \(5 を超えない\)/)).toBeVisible()
})

test('予測を後段の仕組みに渡すと, 後段が求めるものの問いが出る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await page.getByRole('button', { name: /機械学習の受け持ち/ }).click()
  const downstream = page.getByRole('textbox', { name: '後段は何で, 出力に何を求めますか' })
  await expect(downstream).toHaveCount(0)
  await page.getByRole('radio', { name: /後段の仕組みに渡す/ }).check()
  await expect(downstream).toBeVisible()
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText(
    '後段が求める形と精度',
  )
  await downstream.fill('発注の仕組み. 品ごとの個数')
  await downstream.blur()
  await expect(page.getByText(/予測の使い道: 後段の仕組みに渡す/)).toBeVisible()
})

test('相手をまとめる列を選ぶと, 分割が相手ごとになって後ろの段階に渡る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '解約の引き止め' }).click()
  await page.getByRole('button', { name: /機械学習の受け持ち/ }).click()
  await page.getByLabel(/同じ相手の行をまとめる列は/).selectOption('member_id')
  const handoff = page.getByText(/分割は\s*相手ごと/)
  await expect(handoff).toBeVisible()
  await expect(page.getByText(/相手をまとめる列\s*member_id/)).toBeVisible()
})

test('予測するで点群の正解が今の処理の出力なら, 処理を問い, 受け持ちの値を渡す', async ({
  page,
}) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('点群')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '点群' })).toBeVisible()

  // 受け持ちに依らない節 (1 から 4, 9, 10) は API で答える
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const answers: [string, unknown][] = [
    ['issue.owner', '設計の係'],
    ['issue.pain', '計算に時間がかかる'],
    ['issue.current', '毎回計算する'],
    ['issue.kpi.name', '待ち時間'],
    ['issue.kpi.unit', '分'],
    ['issue.kpi.better', 'lower'],
    ['decomposition', [{ cause: '毎回計算する', lever: '近似で省く', ml: true }]],
    ['action.who', '設計の係'],
    ['action.when', '計算の前'],
    ['action.what', '計算を省くか'],
    ['ml.reason', '計算の結果を早く近似したい'],
    ['verification.method', 'backtest'],
    ['verification.backtest', '過去の結果と比べる'],
    ['verification.success', '待ち時間が半分'],
    ['operation.review', '月に 1 回'],
    ['operation.approver', '係の長'],
    ['operation.stop', '外れが増えたら'],
  ]
  for (const [key, value] of answers) {
    const response = await page.request.put(`/api/problems/${id}/answers`, {
      data: { id: key, value },
    })
    expect(response.ok()).toBe(true)
  }
  await page.reload()

  // 受け持ちと正解の種類に答えるまで, タスクの問いは出ない
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^5\b/ })
    .click()
  await choose(page, '機械学習を使いますか', 'はい')
  const task = page.getByRole('radiogroup', { name: 'どの種類の問題ですか' })
  await expect(task).toHaveCount(0)
  await choose(page, '機械学習は何を受け持ちますか', /^予測する/)
  await choose(page, '1 件の単位は', /^まとまり/)
  await choose(page, '出力の形は', /^3D の形/)
  const processName = page.getByRole('textbox', { name: '正解を作る今の処理の名前は' })
  await expect(processName).toHaveCount(0)
  await choose(page, '正解は誰が, いつ, どう確定させますか (正解の出どころ)', /^今の処理の出力/)
  await write(page, '正解を作る今の処理の名前は', '今の計算')
  await write(page, 'その処理の設定は', '既定の設定')
  await choose(page, 'どう作りますか (作り方)', /^一から学習/)
  await choose(page, '正解 (出力) の種類は', /^点群/)
  await expect(task).toHaveCount(0)
  await write(page, '何を出させますか', '形の点群')
  await write(page, '1 件は何ですか', '1 回の撮影')
  await write(page, '機械学習を使わない比べる相手は', '今の計算')

  // 8 の節の指標の候補は, 受け持ちと正解の種類に合うもの
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^8\b/ })
    .click()
  await expect(page.getByRole('radio', { name: /平均絶対誤差/ })).toHaveCount(0)
  await choose(page, '最も良いモデルを何で選びますか', /Chamfer/)

  // 受け持ち, 正解の種類と出どころ, 処理, 指標が渡り, 骨組みは書き出せない
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '後ろの段階に渡す値' }) })
  await expect(card).toContainText('受け持ち: 予測する')
  await expect(card).toContainText('正解の種類: 点群')
  await expect(card).toContainText('正解の出どころ: 今の処理の出力')
  await expect(card).toContainText('正解を作る処理 今の計算')
  await expect(card).toContainText('処理の設定: 既定の設定')
  await expect(card).toContainText('valid/chamfer')
  await expect(page.getByRole('button', { name: '学習のプロジェクトを書き出す' })).toBeDisabled()
  await expect(page.locator('#export-reason')).toContainText('表の列')
})

test('最良を選ぶ指標をその他にすると, 名前と向きを問い, 監視する指標に渡す', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await page.getByRole('button', { name: /学習で見る指標/ }).click()
  const name = page.getByRole('textbox', { name: 'その指標の名前は' })
  await expect(name).toHaveCount(0)
  await choose(page, '最も良いモデルを何で選びますか', /^その他/)
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText(
    'その指標の名前は',
  )
  await write(page, 'その指標の名前は', 'wape')
  await choose(page, 'その指標は, 小さいほど良いですか, 大きいほど良いですか', '小さいほど良い')
  await expect(page.getByText('食い違いや足りない答えはありません.')).toBeVisible()

  // 列の予測の値は今までどおりで, 監視する指標が書いた名前になる
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '後ろの段階に渡す値' }) })
  await expect(card.getByText(/目的の列\s*sales/)).toBeVisible()
  await expect(card.getByText(/監視する指標\s*valid\/wape\s*\(小さいほど良い\)/)).toBeVisible()
  await expect(card.getByText(/その他の指標です/)).toBeVisible()
  await expect(page.getByRole('button', { name: '学習のプロジェクトを書き出す' })).toBeDisabled()
  await expect(page.locator('#export-reason')).toContainText('その他')
})

test('版 1 のファイルを開くと版 2 に移して描き, 保存すると版 2 で書く', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('古い版')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '古い版' })).toBeVisible()

  // 古い ML-Quest のアプリが書いた版 1 のファイルにする
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const file = `${process.cwd()}/e2e/.work/home/problems/${id}/problem.yaml`
  writeFileSync(
    file,
    'format_version: 1\nname: 古い版\nml: {use: true, task: regression, target: sales}\n',
  )
  await page.reload()
  await expect(page.getByRole('note')).toContainText('版 1 の問題の設定のファイルです')
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^5\b/ })
    .click()
  await expect(
    page.getByRole('radiogroup', { name: 'どの種類の問題ですか' }).getByLabel(/^回帰/),
  ).toBeChecked()

  // 答えを保存すると版 2 で書く
  await write(page, '何を出させますか', '売れる数')
  await expect(page.getByRole('note')).toHaveCount(0)
  expect(readFileSync(file, 'utf-8')).toContain('format_version: 2')
})

test('方策をシミュレータで学ぶと, 要る機能の準備のカードと方策の守りが出る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await expect(page.getByRole('heading', { name: '総菜の作る量' })).toBeVisible()
  const prepare = page.locator('section').filter({
    has: page.getByRole('heading', { name: /学習の段階の準備/ }),
  })
  await expect(prepare).toHaveCount(0)

  // 効果を見積もるで, シミュレータ (MuJoCo) で試して集める. 答えの途中からカードが出る
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^5\b/ })
    .click()
  await choose(page, '機械学習は何を受け持ちますか', /^効果を見積もる/)
  await choose(page, '機械学習が, 続けて自分で行動を選びますか (方策)', 'はい')
  await choose(page, '行動の結果のデータは, どう集めますか', /^シミュレータで試して集める/)
  await expect(prepare).toContainText('強化学習')
  await choose(page, 'どのシミュレータを使いますか', /^MuJoCo/)
  await expect(prepare.getByRole('listitem')).toHaveCount(2)
  await expect(prepare).toContainText('MuJoCo (物理のシミュレータ)')
  await expect(prepare).toContainText('このまま続けられます')
  // 準備のカードは何も止めない (問いに答え続けられる)
  await expect(page.getByRole('button', { name: '次の節' })).toBeEnabled()

  // 残りの受け持ちの答えと守りは API で答える
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const part = 'ml.parts.0'
  const answers: [string, unknown][] = [
    ['unit', 'row'],
    ['output', 'effect'],
    ['target.source', 'intervention'],
    ['method', 'scratch'],
    ['what', '試しの出力'],
    ['item', '1 件'],
    ['baseline', '今のやり方'],
    ['evaluation.metric', 'qini'],
    ['evaluation.link', '良くなると損が減る'],
    ['policy.action_limits', '各関節の速さは毎秒 0.5 rad まで'],
    ['policy.stop', '腕の先が台の上 0 から 0.3 m を出たら'],
    ['policy.approver', '設備の責任者'],
  ]
  for (const [key, value] of answers) {
    const response = await page.request.put(`/api/problems/${id}/answers`, {
      data: { id: `${part}.${key}`, value },
    })
    expect(response.ok()).toBe(true)
  }
  await page.reload()

  // 外れたときの動きは画面で選ぶ (7 の節)
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^7\b/ })
    .click()
  await choose(page, '外れたときは, どうしますか', /^元の制御/)
  await expect(page.getByText('食い違いや足りない答えはありません.')).toBeVisible()

  // 後ろの段階に渡す値に, 要る機能と方策の守り, 人が決めることが出る
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '後ろの段階に渡す値' }) })
  await expect(card).toContainText('方策の守り')
  await expect(card).toContainText('行動の上限: 各関節の速さは毎秒 0.5 rad まで')
  await expect(card).toContainText('外れたときの動き: 元の制御')
  await expect(card).toContainText('安全の違反の信号: cost')
  await expect(card).toContainText('人 (設備の責任者) が決めます')
  await expect(card).toContainText('実機で動かすのは道具の外')
  await expect(card).toContainText('学習の段階に要る機能')

  // 集め方を今ある記録にすると, カードは消える
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^5\b/ })
    .click()
  await choose(page, '行動の結果のデータは, どう集めますか', /^今ある記録から/)
  await expect(prepare).toHaveCount(0)
})
