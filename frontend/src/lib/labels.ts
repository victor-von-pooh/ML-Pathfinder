import type { Finding } from '../api/types'

/** 確かめの重さの名前 */
export const LEVEL_NAMES: Record<Finding['level'], string> = {
  error: '直す',
  warning: '見直す',
  info: '知らせ',
}
