/** 零依赖行 diff（8.2）：响应信证据门（RESPONSE_UNBACKED）与投稿 diff 的地基。
 * 纯函数。算法用 LCS 动态规划（Uint8Array 方向矩阵）而非 Myers O(ND)——
 * Myers 在「右移越出 a 末尾」时有 x=N+1 溢出陷阱（回溯会索引越界），
 * LCS 简单正确有界：方向矩阵 1 byte/格，>8M 格（约 2800×2800 行）退化为
 * 「整文件替换」单个 hunk 并在 stats.replaced 标注。只处理文本；
 * PDF/二进制由 service.paperDiff 比哈希（status binary）。 */

export interface DiffLine {
  readonly op: ' ' | '-' | '+'
  readonly text: string
}

export interface DiffHunk {
  /** a/b 侧起始行号（1-based；纯增时 aStart 指向插入点，aCount=0）。 */
  readonly aStart: number
  readonly aCount: number
  readonly bStart: number
  readonly bCount: number
  readonly lines: readonly DiffLine[]
}

export interface PaperDiffFile {
  readonly path: string
  readonly status: 'modified' | 'added' | 'removed' | 'binary'
  readonly hunks: readonly DiffHunk[]
}

export interface PaperDiff {
  readonly schemaVersion: 1
  readonly from: string
  readonly to: string
  readonly createdAt: string
  readonly files: readonly PaperDiffFile[]
  readonly stats: { readonly added: number; readonly removed: number; readonly modified: number; readonly binary: number }
}

/** 方向矩阵格数上限：超过则整文件替换（防 O(N·M) 内存失控）。 */
const MAX_CELLS = 8_000_000

const DIAG = 3
const UP = 1
const LEFT = 2

function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function lcsOps(a: readonly string[], b: readonly string[]): DiffLine[] {
  const N = a.length
  const M = b.length
  if (N === 0) return b.map(text => ({ op: '+' as const, text }))
  if (M === 0) return a.map(text => ({ op: '-' as const, text }))
  if (N * M > MAX_CELLS) {
    return [...a.map(text => ({ op: '-' as const, text })), ...b.map(text => ({ op: '+' as const, text }))]
  }
  const dir = new Uint8Array(N * M)
  let prev = new Int32Array(M + 1)
  for (let i = 1; i <= N; i++) {
    const cur = new Int32Array(M + 1)
    for (let j = 1; j <= M; j++) {
      const cell = (i - 1) * M + (j - 1)
      const av = a[i - 1]!
      const bv = b[j - 1]!
      const up = prev[j]!
      const left = cur[j - 1]!
      if (av === bv) {
        cur[j] = prev[j - 1]! + 1
        dir[cell] = DIAG
      } else if (up > left) {
        cur[j] = up
        dir[cell] = UP
      } else {
        // 平局走 LEFT：回溯先推 '+'，反转后 hunk 内 '-' 在 '+' 前（标准 diff 惯例）
        cur[j] = left
        dir[cell] = LEFT
      }
    }
    prev = cur
  }
  const ops: DiffLine[] = []
  let i = N
  let j = M
  while (i > 0 && j > 0) {
    const d = dir[(i - 1) * M + (j - 1)]
    if (d === DIAG) {
      ops.push({ op: ' ', text: a[i - 1]! })
      i -= 1
      j -= 1
    } else if (d === UP) {
      ops.push({ op: '-', text: a[i - 1]! })
      i -= 1
    } else {
      ops.push({ op: '+', text: b[j - 1]! })
      j -= 1
    }
  }
  while (i > 0) {
    ops.push({ op: '-', text: a[i - 1]! })
    i -= 1
  }
  while (j > 0) {
    ops.push({ op: '+', text: b[j - 1]! })
    j -= 1
  }
  return ops.reverse()
}

/** 行 diff → hunk 列表：被上下文（未变行）隔开的变更各自成 hunk。 */
export function diffLines(aText: string, bText: string): readonly DiffHunk[] {
  const a = splitLines(aText)
  const b = splitLines(bText)
  const ops = lcsOps(a, b)
  const hunks: DiffHunk[] = []
  let aStart = 0
  let bStart = 0
  let aCount = 0
  let bCount = 0
  let lines: DiffLine[] = []
  let ai = 0
  let bi = 0
  const flush = (): void => {
    if (lines.length > 0) {
      hunks.push({ aStart, aCount, bStart, bCount, lines })
      lines = []
      aCount = 0
      bCount = 0
    }
  }
  for (const op of ops) {
    if (op.op === ' ') {
      flush()
      ai += 1
      bi += 1
      continue
    }
    if (lines.length === 0) {
      aStart = ai + 1
      bStart = bi + 1
    }
    lines.push(op)
    if (op.op === '-') {
      aCount += 1
      ai += 1
    } else {
      bCount += 1
      bi += 1
    }
  }
  flush()
  return hunks
}
