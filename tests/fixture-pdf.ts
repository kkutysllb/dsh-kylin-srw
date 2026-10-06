/** 手造最小 PDF（多行多页）：测试共享助手——无二进制 fixture 入库。 */

export interface FixtureLine {
  readonly x: number
  readonly y: number
  readonly text: string
  readonly size?: number
}

export function buildFixturePdf(lines: readonly FixtureLine[], pages = 1): Uint8Array {
  const esc = (text: string): string => text.replace(/([\\()])/g, '\\$1')
  const perPage = Math.ceil(lines.length / pages)
  const bodies = new Map<number, string>()
  const pageIds: number[] = []
  // 1: catalog, 2: pages, 3: font；内容流从 4 起、页跟在其后
  let nextId = 4
  for (let page = 0; page < pages; page += 1) {
    const slice = lines.slice(page * perPage, (page + 1) * perPage)
    let stream = ''
    for (const line of slice) {
      stream += `BT /F1 ${line.size ?? 10} Tf 1 0 0 1 ${line.x} ${line.y} Tm (${esc(line.text)}) Tj ET\n`
    }
    const contentId = nextId
    const pageId = nextId + 1
    nextId += 2
    bodies.set(contentId, `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`)
    bodies.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  }
  const chunks: string[] = ['%PDF-1.4\n']
  const offsets = new Map<number, number>()
  const put = (id: number, body: string): void => {
    offsets.set(id, chunks.join('').length)
    chunks.push(`${id} 0 obj\n${body}\nendobj\n`)
  }
  put(1, '<< /Type /Catalog /Pages 2 0 R >>')
  put(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  put(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  for (const [id, body] of bodies) put(id, body)
  const maxId = Math.max(...bodies.keys(), 3)
  const xref = chunks.join('').length
  chunks.push(`xref\n0 ${maxId + 1}\n0000000000 65535 f \n`)
  for (let id = 1; id <= maxId; id += 1) {
    chunks.push(offsets.has(id)
      ? `${String(offsets.get(id)).padStart(10, '0')} 00000 n \n`
      : '0000000000 65535 f \n')
  }
  chunks.push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)
  return new Uint8Array(Buffer.from(chunks.join(''), 'latin1'))
}
