import { existsSync, readFileSync, writeFileSync } from 'node:fs'

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

/**
 * 学習のプロジェクトを書き出し, 対話の知らせに文があるかを確かめて閉じ, 書き出した場所を返す
 * (直すところが無いとき)
 */
async function exportProject(page: Page, name: string, texts: string[] = []): Promise<string> {
  const dir = `${process.cwd()}/e2e/.work/${name}`
  await page.getByRole('button', { name: '学習のプロジェクトを書き出す' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('書き出すディレクトリ (無ければ作る)').fill(dir)
  await dialog.getByRole('button', { name: '書き出す' }).click()
  await expect(dialog.getByRole('status')).toContainText('train.py')
  for (const text of texts) await expect(dialog.getByRole('status')).toContainText(text)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  return dir
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

  // 書き出した場所は問題の設定に記録され, 受け渡しの値に出る (データセットとモデルの定義の置き場も)
  await expect(dialog.getByRole('status')).toContainText('この場所を問題の設定に記録しました')
  await expect(dialog.getByRole('status')).toContainText('検証用とテスト用で今のやり方と比べた評価')
  await page.keyboard.press('Escape')
  await expect(page.getByText('学習のプロジェクト (書き出した場所)')).toBeVisible()
  await expect(
    page.getByText(`${process.cwd()}/e2e/.work/project/outputs/dataset`, { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(`${process.cwd()}/e2e/.work/project/models/model.yaml`, { exact: true }),
  ).toBeVisible()
})

test('直すところが残ると, 一覧を確かめてから書き出し, README に一覧が残る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await expect(page.getByRole('heading', { name: '総菜の作る量' })).toBeVisible()

  // 課題の持ち主を消すと受け渡せないが, 骨組みは組めるので押せる
  await write(page, '誰の課題ですか', '')
  await expect(page.getByText(/直すところが 1 件残っています. 書き出すときに/)).toBeVisible()
  const open = page.getByRole('button', { name: '学習のプロジェクトを書き出す' })
  await expect(open).toBeEnabled()
  await open.click()

  // 一覧を出し, 「それでも書き出す」を確かめるまで書き出せない (キーボードで確かめる)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('list', { name: '残っている直すところ' })).toContainText(
    '誰の課題ですか',
  )
  const target = `${process.cwd()}/e2e/.work/open-errors-project`
  await dialog.getByLabel('書き出すディレクトリ (無ければ作る)').fill(target)
  await expect(dialog.getByRole('button', { name: '書き出す', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /それでも書き出す/ }).focus()
  await page.keyboard.press('Space')
  await dialog.getByRole('button', { name: '直すところが残ったまま書き出す' }).click()
  await expect(dialog.getByRole('status')).toContainText('train.py')
  const readme = readFileSync(`${target}/README.md`, 'utf-8')
  expect(readme).toContain('書き出した時点で残っていた直すところ')
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

test('文の問いは, 問いの欄の形で 1 行の欄か複数行の欄になる', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await expect(page.getByRole('heading', { name: '総菜の作る量' })).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const view = await (await page.request.get(`/api/problems/${id}`)).json()
  const texts = (
    view.questions as {
      id: string
      section: number
      kind: string
      applies: boolean
      multiline: boolean
    }[]
  ).filter((q) => q.kind === 'text' && q.applies)
  // 名前で答える問い (課題の持ち主, 指標の名前と単位, 承認する人など) は 1 行, 他は複数行
  expect(texts.some((q) => !q.multiline)).toBe(true)
  expect(texts.some((q) => q.multiline)).toBe(true)
  for (const question of texts) {
    await page
      .getByRole('navigation', { name: '問いの節' })
      .getByRole('button', { name: new RegExp(`^${question.section}\\b`) })
      .click()
    const box = page.locator(`[id="q-${question.id}"]`)
    await expect(box).toBeVisible()
    expect(await box.evaluate((node) => node.tagName), question.id).toBe(
      question.multiline ? 'TEXTAREA' : 'INPUT',
    )
  }
  const names = texts.filter((q) => !q.multiline).map((q) => q.id)
  expect(names).toEqual(
    expect.arrayContaining(['issue.owner', 'issue.kpi.name', 'operation.approver']),
  )
})

test('1 行の欄は, 手で書いた答えの改行を空白にして出し, 直すと 1 行で保存する', async ({
  page,
}) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('改行')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '改行' })).toBeVisible()
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const file = `${process.cwd()}/e2e/.work/home/problems/${id}/problem.yaml`
  writeFileSync(file, 'format_version: 2\nname: 改行\nissue:\n  owner: "店長\\n副店長"\n')
  await page.reload()
  const box = page.getByRole('textbox', { name: '誰の課題ですか', exact: true })
  await expect(box).toHaveValue('店長 副店長')
  await box.fill(`${await box.inputValue()} と本部`)
  await box.blur()
  await expect(page.getByText('「誰の課題ですか」を保存しました')).toBeVisible()
  const view = await (await page.request.get(`/api/problems/${id}`)).json()
  const owner = (view.questions as { id: string; value: unknown }[]).find(
    (q) => q.id === 'issue.owner',
  )
  expect(owner?.value).toBe('店長 副店長 と本部')
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
  // 期の数の欄の名前は ML-Quest の問いの欄から
  await page.getByLabel(/期の数 k/).fill('1')
  await page.getByRole('button', { name: '保存' }).last().click()
  await expect(page.getByText(/今のやり方の損は, 39 日で/).first()).toBeVisible({ timeout: 20_000 })

  // 2 の節の指標の今の値に, データからの候補が出る
  await nav.getByRole('button', { name: /^2\b/ }).click()
  await expect(page.getByRole('group', { name: /今のやり方の損をデータで求めた値/ })).toBeVisible()
})

test('値を決める手伝いで損得の幅を書くと, 振れ幅の大きい順に結論の表が出る', async ({ page }) => {
  // 総菜の見本と同じ列の 40 日 × 1 店 × 1 品 (曜日で決まる売れた数)
  const rows = ['date,store,item,sales,temperature_forecast,promo,customers']
  for (let day = 0; day < 40; day++) {
    const date = new Date(Date.UTC(2025, 0, 1 + day))
    const sales = 10 + date.getUTCDay() * 3
    rows.push(`${date.toISOString().slice(0, 10)},east,a,${sales},15,0,${sales * 3}`)
  }
  const file = `${process.cwd()}/e2e/.work/sensitivity.csv`
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
  await expect(page.getByText('40 行, 7 列')).toBeVisible()
  await nav.getByRole('button', { name: /^7\b/ }).click()
  await page.getByLabel('今のやり方をデータで書くと').selectOption('lag')
  await page.getByLabel(/期の数 k/).fill('1')
  await page.getByRole('button', { name: '保存' }).last().click()
  await expect(page.getByText(/今のやり方の損は, 39 日で/).first()).toBeVisible({ timeout: 20_000 })

  // 開くと幅の欄が出る (今ある量と量の刻みは結論を変えないので出さない)
  await page.getByRole('button', { name: '値を決める手伝い' }).click()
  await expect(page.getByLabel('今ある量の下')).toHaveCount(0)
  await page.getByLabel('1 単位足りないときの損の下').fill('100')
  await page.getByLabel('1 単位足りないときの損の上').fill('300')
  await page.getByLabel('1 単位余ったときの損の下').fill('150')
  await page.getByLabel('1 単位余ったときの損の上').fill('151')
  await page.getByRole('button', { name: '求める' }).click()
  const sections = page.getByRole('region', { name: /の幅$/ })
  await expect(sections).toHaveCount(2, { timeout: 20_000 })
  await expect(sections.first()).toHaveAccessibleName('足りないときの損の幅')
  await expect(sections.first()).toContainText('決め手')
  await expect(sections.first()).toContainText('今のやり方の損 (30 日あたり)')
  await expect(sections.first()).toContainText('置く分位点の水準は 0.40 から 0.67')
  await expect(page.getByRole('list', { name: '知らせ' })).toContainText('予測')

  // 幅の誤りは, ML-Quest の文を画面の誤りに出す
  await page.getByLabel('1 単位余ったときの損の上').fill('100')
  await page.getByRole('button', { name: '求める' }).click()
  await expect(page.getByRole('alert')).toContainText('over_cost の幅は, 下を上以下にしてください')
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

test('予測するで点群の正解が今の処理の出力なら, 処理を問い, データセットを入れて書き出す', async ({
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

  // 受け持ち, 正解の種類と出どころ, 処理, 指標が渡り, データが無くても骨組みを書き出せる
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '後ろの段階に渡す値' }) })
  await expect(card).toContainText('受け持ち: 予測する')
  await expect(card).toContainText('正解の種類: 点群')
  await expect(card).toContainText('正解の出どころ: 今の処理の出力')
  await expect(card).toContainText('正解を作る処理 今の計算')
  await expect(card).toContainText('処理の設定: 既定の設定')
  await expect(card).toContainText('valid/chamfer')
  await expect(card.getByText(/監視の向き/)).toHaveText(/監視の向き\s*min\s*\(小さいほど良い\)/)
  // 一から学習する点群の予測は, 受け持ちに合う雛形の名前を渡す
  await expect(card.getByText(/モデルの作成の雛形/)).toHaveText(
    /モデルの作成の雛形:\s*point_cloud_predictor\s*\(モデルの作成の画面で開ける例\)/,
  )
  await expect(page.getByRole('button', { name: '学習のプロジェクトを書き出す' })).toBeEnabled()
  await expect(page.locator('#export-reason')).toHaveCount(0)

  // ML-EDA の版 2 のデータセットのディレクトリ (serve.sh が書き出したもの) を選んで入れる
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^5\b/ })
    .click()
  await page.getByRole('button', { name: 'データを入れる' }).click()
  const picker = page.getByRole('dialog')
  await picker.getByLabel('パス').fill(`${process.cwd()}/e2e/.work`)
  await picker.getByRole('button', { name: '移動' }).click()
  const entry = picker.getByRole('button', { name: /^clouds\s*データセット$/ })
  await expect(entry).toBeVisible()
  await entry.click()
  await picker.getByRole('button', { name: '選ぶ', exact: true }).click()
  await expect(picker).toHaveCount(0)

  // 表の概要の代わりに, 件数と正解の種類を確かめで知らせる
  const checks = page.getByRole('list', { name: '手元のデータは の確かめ' })
  await expect(checks).toContainText('ML-EDA の版 2 のデータセット', { timeout: 20_000 })
  await expect(checks).toContainText('point_cloud')
  await expect(page.getByText(/\d+ 行, \d+ 列/)).toHaveCount(0)

  // 書き出すとスクリプト, config, README とデータセットの写しができる (学習はしない)
  await page.getByRole('button', { name: '学習のプロジェクトを書き出す' }).click()
  const dialog = page.getByRole('dialog')
  const target = `${process.cwd()}/e2e/.work/cloud-project`
  await dialog.getByLabel('書き出すディレクトリ (無ければ作る)').fill(target)
  await dialog.getByRole('button', { name: '書き出す' }).click()
  await expect(dialog.getByRole('status')).toContainText('train.py')
  await expect(dialog.getByRole('status')).toContainText('model.spec')
  for (const file of [
    'train.py',
    'README.md',
    'configs/default/train.yaml',
    'data/clouds/dataset.yaml',
  ])
    expect(existsSync(`${target}/${file}`), file).toBe(true)
  expect(readFileSync(`${target}/configs/default/train.yaml`, 'utf8')).toContain('data/clouds')
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
  await expect(card.getByText(/監視する指標\s*valid\/wape/)).toBeVisible()
  await expect(card.getByText(/監視の向き\s*min\s*\(小さいほど良い\)/)).toBeVisible()
  // 列の予測には合う雛形が無いので, 言葉で出す
  await expect(card.getByText(/モデルの作成の雛形/)).toContainText(
    'モデルの作成の雛形: 受け持ちに合う雛形はありません',
  )
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

test('方策をシミュレータで学ぶと, 準備のカードと方策の守りが出て, 最良を選ぶ指標に報酬が出る', async ({
  page,
}) => {
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
  // 環境の登録名は任意. 画面で答えて保存する (MuJoCo の環境もここで名前を答える)
  await write(page, 'Gymnasium の環境の登録名は (あれば)', 'Hopper-v5')
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
    ['evaluation.metric', 'loss'],
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
  // 安全の違反の信号と承認する人は名前で答えるので 1 行の欄
  const signal = page.getByRole('textbox', {
    name: '安全の違反を知らせる信号の名前は',
    exact: true,
  })
  expect(await signal.evaluate((node) => node.tagName)).toBe('INPUT')
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^10\b/ })
    .click()
  const approver = page.getByRole('textbox', {
    name: '方策を使ってよいかと, 守りの範囲は誰が決めますか',
    exact: true,
  })
  await expect(approver).toHaveValue('設備の責任者')
  expect(await approver.evaluate((node) => node.tagName)).toBe('INPUT')
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

  // 答えた環境の登録名は受け渡しの方策と保存したファイルに入る (骨組みはそこから読む)
  await expect(card).toContainText('方策を学ぶ環境 (学習, 評価)')
  await expect(card).toContainText('Gymnasium の Hopper-v5')
  const saved = await (await page.request.get(`/api/problems/${id}`)).json()
  expect(saved.handoff.policy.env_id).toBe('Hopper-v5')
  const file = await (await page.request.get(`/api/problems/${id}/download`)).text()
  expect(file).toContain('env_id: Hopper-v5')

  // 書き出した骨組みは, config の env.id にその登録名を書き, 自作の環境の雛形は書かない
  const named = await exportProject(page, 'policy-named', [
    'Gymnasium の Hopper-v5 (config の env.id)',
    'config の guards に',
    '観測と行動の空間に合わせた',
    'policy/ に守りと一緒に',
    '守りを当てたまま環境で',
    'この場所を問題の設定に記録しました. モデルの定義は',
    '(後ろの段階のアプリはこの記録から場所を読みます)',
  ])
  expect(readFileSync(`${named}/configs/default/train.yaml`, 'utf8')).toContain('id: "Hopper-v5"')
  expect(existsSync(`${named}/env.py`)).toBe(false)
  // 方策で損失を選んだ設定もそのまま開いて書き出せ, 監視は valid/loss を小さく
  const lossConfig = readFileSync(`${named}/configs/default/train.yaml`, 'utf8')
  expect(lossConfig).toMatch(/^ {2}monitor: valid\/loss$/m)
  expect(lossConfig).toMatch(/^ {2}mode: min$/m)

  // 方策の最良を選ぶ指標は報酬が先頭に出て, 選ぶと監視が valid/reward を大きく
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^8\b/ })
    .click()
  const metric = page.getByRole('radiogroup', {
    name: '最も良いモデルを何で選びますか',
    exact: true,
  })
  await expect(metric.getByRole('radio').first()).toHaveAttribute('value', 'reward')
  await choose(page, '最も良いモデルを何で選びますか', /^評価のエピソードの報酬の和の平均 \(/)
  await expect(page.getByText('食い違いや足りない答えはありません.')).toBeVisible()
  const reward = await exportProject(page, 'policy-reward')
  const rewardConfig = readFileSync(`${reward}/configs/default/train.yaml`, 'utf8')
  expect(rewardConfig).toMatch(/^ {2}monitor: valid\/reward$/m)
  expect(rewardConfig).toMatch(/^ {2}mode: max$/m)

  // 空に戻すと, 骨組みに自作の環境の雛形を書き出すことを案内する
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^5\b/ })
    .click()
  await write(page, 'Gymnasium の環境の登録名は (あれば)', '')
  await expect(card).toContainText('自作の環境 (環境の登録名は答えていません)')
  await expect(card).toContainText('骨組みには自作の環境の雛形 (env.py) を書き出す')

  // カードの問いへのリンクで, 1 行の登録名の欄に移る
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^7\b/ })
    .click()
  await card.getByRole('button', { name: '5 の「Gymnasium の環境の登録名は (あれば)」' }).click()
  const envBox = page.getByRole('textbox', {
    name: 'Gymnasium の環境の登録名は (あれば)',
    exact: true,
  })
  await expect(envBox).toBeFocused()
  expect(await envBox.evaluate((node) => node.tagName)).toBe('INPUT')

  // 書き出した骨組みは, env.id が null で, 自作の環境の雛形 env.py を持つ
  const own = await exportProject(page, 'policy-own', ['自作の環境の雛形 env.py (ProjectEnv)'])
  expect(readFileSync(`${own}/configs/default/train.yaml`, 'utf8')).toMatch(/^ {2}id: null$/m)
  expect(readFileSync(`${own}/env.py`, 'utf8')).toContain('class ProjectEnv')

  // 集め方を今ある記録にすると, カードと環境の登録名の問いは消える
  await choose(page, '行動の結果のデータは, どう集めますか', /^今ある記録から/)
  await expect(prepare).toHaveCount(0)
  await expect(
    page.getByRole('textbox', { name: 'Gymnasium の環境の登録名は (あれば)', exact: true }),
  ).toHaveCount(0)
  await expect(card).not.toContainText('方策を学ぶ環境')

  // 方策でないと答えると報酬は選択肢から外れ, 選んである報酬は合わないと出る
  await choose(page, '機械学習が, 続けて自分で行動を選びますか (方策)', 'いいえ')
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^8\b/ })
    .click()
  await expect(metric.getByLabel(/^評価のエピソードの報酬の和の平均/)).toHaveCount(0)
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText(
    /報酬の和の平均.*合いません/,
  )
})

test('作るで画像と答えると, 画像の生成の骨組みを書き出し, 次にすることが生成の手順になる', async ({
  page,
}) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await expect(page.getByRole('heading', { name: '総菜の作る量' })).toBeVisible()

  // 受け持ちと正解の種類, 出力の形, 指標を API で答える (条件の無い画像の生成)
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const answers: [string, unknown][] = [
    ['role', 'generate'],
    ['target.kind', 'image'],
    ['output', 'image'],
    ['evaluation.metric', 'loss'],
  ]
  for (const [key, value] of answers) {
    const response = await page.request.put(`/api/problems/${id}/answers`, {
      data: { id: `ml.parts.0.${key}`, value },
    })
    expect(response.ok()).toBe(true)
  }
  await page.reload()

  // 後ろの段階に渡す値は, 画像と表の生成では分割を渡すと書く
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '後ろの段階に渡す値' }) })
  await expect(card).toContainText('画像と表の生成は分割を渡します')

  await page.getByRole('button', { name: '学習のプロジェクトを書き出す' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('正解の種類と受け持ちから')
  await dialog
    .getByLabel('書き出すディレクトリ (無ければ作る)')
    .fill(`${process.cwd()}/e2e/.work/generate`)
  await dialog.getByRole('button', { name: '書き出す' }).click()
  const status = dialog.getByRole('status')
  await expect(status).toContainText('train.py')
  await expect(status).toContainText('目的の列の無いレシピ')
  await expect(status).toContainText('件数と種で画像を作る推論の一式')
  await expect(status).toContainText('データセットは')
  await expect(status).not.toContainText('意思決定')
  const readme = readFileSync(`${process.cwd()}/e2e/.work/generate/README.md`, 'utf8')
  expect(readme).toContain('条件の無い拡散のモデルを学ぶ')
})

test('作るで表と画面で答え, 表を入れると, 列ごとの分布の近さを選べて表の生成の骨組みを書き出す', async ({
  page,
}) => {
  // 数の列と種類の列の表
  const rows = ['age,income,city']
  for (let index = 0; index < 60; index++)
    rows.push(`${20 + (index % 40)},${300 + ((index * 7) % 50) * 10},${'abc'[index % 3]}`)
  const file = `${process.cwd()}/e2e/.work/customers.csv`
  writeFileSync(file, rows.join('\n') + '\n')

  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('似た表')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '似た表' })).toBeVisible()

  // 受け持ちに依らない節 (1 から 4, 9, 10) は API で答える
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const answers: [string, unknown][] = [
    ['issue.owner', '営業の係'],
    ['issue.pain', '顧客の表を外に出せない'],
    ['issue.current', '手で作った表で試す'],
    ['issue.kpi.name', '試しの準備の日数'],
    ['issue.kpi.unit', '日'],
    ['issue.kpi.better', 'lower'],
    ['decomposition', [{ cause: '本物の表を使えない', lever: '似た表を作る', ml: true }]],
    ['action.who', '営業の係'],
    ['action.when', '試しの前'],
    ['action.what', '作った表で試す'],
    ['ml.reason', '元の表に似た行を作りたい'],
    ['verification.method', 'backtest'],
    ['verification.backtest', '過去の表と比べる'],
    ['verification.success', '準備の日数が半分'],
    ['operation.review', '月に 1 回'],
    ['operation.approver', '係の長'],
    ['operation.stop', '似なくなったら'],
  ]
  for (const [key, value] of answers) {
    const response = await page.request.put(`/api/problems/${id}/answers`, {
      data: { id: key, value },
    })
    expect(response.ok()).toBe(true)
  }
  await page.reload()

  // 5 の節で, 作るで正解の種類を表と画面で答える
  const nav = page.getByRole('navigation', { name: '問いの節' })
  await nav.getByRole('button', { name: /^5\b/ }).click()
  await choose(page, '機械学習を使いますか', 'はい')
  await choose(page, '機械学習は何を受け持ちますか', /^作る/)
  await choose(page, '1 件の単位は', /^行/)
  await choose(page, '出力の形は', /^表 \(合成のデータ\)/)
  await choose(page, '正解は誰が, いつ, どう確定させますか (正解の出どころ)', /^自分自身/)
  await choose(page, 'どう作りますか (作り方)', /^一から学習/)
  await choose(page, '正解 (出力) の種類は', /^表 \(合成のデータ\)/)
  await write(page, '何を出させますか', '顧客の表に似た行')
  await write(page, '1 件は何ですか', '顧客の 1 行')
  await write(page, '機械学習を使わない比べる相手は', '手で作る')

  // 手元のデータに表を選んで入れる
  await page.getByRole('button', { name: 'データを入れる' }).click()
  const picker = page.getByRole('dialog')
  await picker.getByLabel('パス').fill(file)
  await picker.getByRole('button', { name: '移動' }).click()
  await picker.getByRole('button', { name: '選ぶ', exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.getByText('60 行, 3 列')).toBeVisible({ timeout: 20_000 })

  // 8 の節の指標の候補に列ごとの分布の近さが言葉と向きの付いた名前で出て, 画像の FID は出ない
  await nav.getByRole('button', { name: /^8\b/ }).click()
  const metric = page.getByRole('radiogroup', {
    name: '最も良いモデルを何で選びますか',
    exact: true,
  })
  await expect(metric.getByLabel(/列ごとの分布の近さ/)).toBeVisible()
  await expect(metric).toContainText(/列ごとの分布の近さ.*小さいほど良い/)
  await expect(metric.getByLabel(/FID/)).toHaveCount(0)
  await choose(page, '最も良いモデルを何で選びますか', /列ごとの分布の近さ/)
  await write(
    page,
    'その指標が良くなると, 課題の指標はどう良くなりますか',
    '近いほど代わりに使える',
  )

  // 確かめに直すところ (食い違い) が無い
  const list = page.getByRole('list', { name: '確かめ', exact: true })
  await expect(list.getByText('直す', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '学習のプロジェクトを書き出す' })).toBeEnabled()
  await expect(page.locator('#export-reason')).toHaveCount(0)

  // 後ろの段階に渡す値に, 表の生成の雛形と, 分布の近さを小さく見る監視が出る
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '後ろの段階に渡す値' }) })
  await expect(card).toContainText('正解の種類: 表')
  await expect(card.getByText(/モデルの作成の雛形/)).toHaveText(
    /モデルの作成の雛形:\s*diffusion_denoiser\s*\(モデルの作成の画面で開ける例\)/,
  )
  await expect(card.getByText(/監視する指標/)).toHaveText(
    /監視する指標\s*valid\/column_distance\s*\(作った表と本物の表の列ごとの分布の近さ\)/,
  )
  await expect(card.getByText(/監視の向き/)).toHaveText(/監視の向き\s*min\s*\(小さいほど良い\)/)
  await expect(card).toContainText('画像と表の生成は分割を渡します')

  // 書き出すと, 表の生成の手順と, 入れた表の写しができる
  const target = `${process.cwd()}/e2e/.work/table-project`
  await exportProject(page, 'table-project', [
    'ML-Fathom で表を読み',
    'diffusion_denoiser',
    '行の数と種で表を作る推論の一式',
    'データセットは',
  ])
  for (const file of ['train.py', 'README.md', 'configs/default/train.yaml', 'data/customers.csv'])
    expect(existsSync(`${target}/${file}`), file).toBe(true)
  expect(readFileSync(`${target}/README.md`, 'utf8')).toContain('元の表に似た行を作る')
  const config = readFileSync(`${target}/configs/default/train.yaml`, 'utf8')
  expect(config).toContain('valid/column_distance')
})

test('データの場所が文字でないファイルは, 確かめに形の誤りを 1 件だけ出し, 欄から外せる', async ({
  page,
}) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('場所が数')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '場所が数' })).toBeVisible()
  page.on('dialog', (dialog) => void dialog.accept())

  // 手で書いて場所を数にしたファイル
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const file = `${process.cwd()}/e2e/.work/home/problems/${id}/problem.yaml`
  writeFileSync(file, 'format_version: 2\nname: 場所が数\ndata: {source: 123, loader: csv}\n')
  await page.reload()
  // ML-Quest の確かめとデータの分析が同じ誤りを返しても, 1 件だけ出す (文は ML-Quest が
  // 決めるので, API の確かめから引く)
  const errorsOf = async (key: string) => {
    const view = await (await page.request.get(`/api/problems/${id}`)).json()
    return (view.findings as { level: string; id: string; message: string }[]).filter(
      (finding) => finding.id === key,
    )
  }
  const errors = await errorsOf('data.source')
  expect(errors.map((finding) => finding.level)).toEqual(['error'])
  const list = page.getByRole('list', { name: '確かめ', exact: true })
  const item = list.getByRole('listitem').filter({ hasText: errors[0].message })
  await expect(item).toHaveCount(1)

  // 確かめから手元のデータの欄に移ると (機械学習を使うと決める前でも出る), 場所の誤りが出て,
  // 外すと他の確かめが戻る
  await item.getByRole('button', { name: /の問いへ/ }).click()
  const field = page.locator('[id="field-data.source"]')
  await expect(field).toContainText('場所が誤っています')
  await expect(field).toContainText(errors[0].message)
  await field.getByRole('button', { name: 'データを外す' }).click()
  await expect(item).toHaveCount(0)
  // 機械学習を使うと決める前なので, 外すと手元のデータの欄は要らない問いに戻る
  await expect(field).toHaveCount(0)
  await expect(list).toContainText('何に困っていますか')

  // 手元のデータの項目が辞書でない間も, 確かめから欄に移って外せる
  writeFileSync(file, 'format_version: 2\nname: 場所が数\ndata: [1, 2]\n')
  await page.reload()
  const shape = await errorsOf('data')
  expect(shape.map((finding) => finding.level)).toEqual(['error'])
  const shapeItem = list.getByRole('listitem').filter({ hasText: shape[0].message })
  await shapeItem.getByRole('button', { name: /の問いへ/ }).click()
  await expect(field).toContainText('場所が誤っています')
  await expect(field).toContainText(shape[0].message)
  await field.getByRole('button', { name: 'データを外す' }).click()
  await expect(shapeItem).toHaveCount(0)
  await expect(field).toHaveCount(0)

  // 数の場所からデータを入れ直しても, 他の確かめが戻る
  writeFileSync(file, 'format_version: 2\nname: 場所が数\ndata: {source: 123, loader: csv}\n')
  await page.reload()
  await expect(item).toHaveCount(1)
  const csv = `${process.cwd()}/e2e/.work/sales.csv`
  writeFileSync(csv, 'date,sales\n2024-01-01,1\n2024-01-02,2\n')
  const attached = await page.request.post(`/api/problems/${id}/data`, { data: { path: csv } })
  expect(attached.ok(), await attached.text()).toBe(true)
  await page.reload()
  await expect(item).toHaveCount(0)
  await expect(list).toContainText('何に困っていますか')
})

// 既製のモデルをそのまま使う見本は, 学習の欄が無く, 推論に出どころを出し, 学習しない骨組みを書き出す
test('既製のモデルの見本は, 学習の欄を出さず, 推論の一式の骨組みを書き出す', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '写真の仕分け (既製のモデル)' }).click()
  await expect(page.getByRole('heading', { name: '写真の仕分け (既製のモデル)' })).toBeVisible()
  await expect(page.getByText('監視する指標')).toHaveCount(0)
  await expect(page.getByText('既製のモデルをそのまま使います')).toBeVisible()
  await expect(page.getByText(/モデルは作りません/)).toBeVisible()
  await expect(page.getByText(/モデルの作成の雛形/)).toHaveCount(0)
  await expect(page.getByText('resnet18', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '学習のプロジェクトを書き出す' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('書き出すディレクトリ (無ければ作る)')
    .fill(`${process.cwd()}/e2e/.work/ready-project`)
  await dialog.getByRole('button', { name: '書き出す' }).click()
  await expect(dialog.getByRole('status')).toContainText('bundle.py')
  await expect(dialog.getByRole('status')).toContainText('outputs/inference')
})
