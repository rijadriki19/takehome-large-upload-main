import fs from "fs/promises"
import path from "path"

export const DATA_DIR = path.join(process.cwd(), ".data")

export async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

export async function writeChunk(sessionId: string, chunkIndex: number, bytes: ArrayBuffer) {
  const dir = path.join(DATA_DIR, sessionId)
  await ensureDir(dir)
  const name = `chunk-${String(chunkIndex).padStart(6, "0")}.bin`
  await fs.writeFile(path.join(dir, name), Buffer.from(bytes))
}

export async function listChunks(sessionId: string) {
  const dir = path.join(DATA_DIR, sessionId)
  const files = await fs.readdir(dir)
  return files.filter((f) => f.startsWith("chunk-") && f.endsWith(".bin")).sort()
}

export async function readChunk(sessionId: string, filename: string) {
  const filePath = path.join(DATA_DIR, sessionId, filename)
  return await fs.readFile(filePath)
}

export async function writeAssembled(sessionId: string, bytes: Buffer) {
  const dir = path.join(DATA_DIR, sessionId)
  await ensureDir(dir)
  const out = path.join(dir, "assembled.csv")
  await fs.writeFile(out, bytes)
  return out
}

/** Read only the first maxBytes of assembled.csv. Use for fast preview without loading full file. */
export async function readAssembledSlice(sessionId: string, maxBytes: number): Promise<Buffer | null> {
  const filePath = path.join(DATA_DIR, sessionId, "assembled.csv")
  const fd = await fs.open(filePath, "r").catch(() => null)
  if (!fd) return null
  try {
    const buffer = Buffer.alloc(Math.min(maxBytes, (await fd.stat()).size))
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await fd.close()
  }
}

/** Read only the first maxBytes from chunks (in order). Use for preview when assembled doesn't exist yet. */
export async function readChunksSlice(
  sessionId: string,
  maxBytes: number,
): Promise<Buffer> {
  const files = await listChunks(sessionId)
  const parts: Buffer[] = []
  let total = 0
  for (const f of files) {
    if (total >= maxBytes) break
    const chunk = await readChunk(sessionId, f)
    const needed = maxBytes - total
    parts.push(chunk.length <= needed ? chunk : chunk.subarray(0, needed))
    total += chunk.length
    if (chunk.length > needed) break
  }
  return Buffer.concat(parts)
}

