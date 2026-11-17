/** ファイルの大きさを読みやすい単位で */
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`
}

/** ISO 8601 の時刻を, 手元の日付と時刻で */
export function formatTime(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })
}
