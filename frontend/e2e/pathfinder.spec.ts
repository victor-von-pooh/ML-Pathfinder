import { expect, test } from '@playwright/test'

// 作業用の置き場で, 見本を開き, 答えを変えて確かめが変わり, 骨組みを書き出す
test('見本を開いて答えを変え, 学習のプロジェクトを書き出す', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await expect(page.getByRole('heading', { name: '総菜の作る量' })).toBeVisible()
  await expect(page.getByText('食い違いや足りない答えはありません.')).toBeVisible()

  // タスクを分類に変えると, 量を決める行動と食い違う
  await page.getByRole('button', { name: /機械学習の受け持ち/ }).click()
  await page.getByRole('radio', { name: /分類/ }).check()
  await expect(page.getByRole('list', { name: '確かめ' })).toContainText('量を決めるには')
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
