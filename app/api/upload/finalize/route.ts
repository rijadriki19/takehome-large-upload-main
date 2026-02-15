import { NextResponse } from "next/server"
import {
  listChunks,
  readChunk,
  readAssembledSlice,
  readChunksSlice,
  writeAssembled,
} from "@/lib/storage"
import { parseCsvPreview } from "@/lib/csv"

export const runtime = "nodejs"

// Node.js string limit is ~512MB. We only need first N lines for preview.
// Slice to first 5MB to avoid ERR_STRING_TOO_LONG on large files.
const PREVIEW_MAX_BYTES = 5 * 1024 * 1024

/** Trim buffer to end at last complete line (avoid partial row in CSV parse). */
function trimToCompleteLines(buffer: Buffer): Buffer {
  const slice =
    buffer.length <= PREVIEW_MAX_BYTES ? buffer : buffer.subarray(0, PREVIEW_MAX_BYTES)
  const lastNewline = slice.lastIndexOf(0x0a) // \n
  if (lastNewline === -1) return slice
  return slice.subarray(0, lastNewline + 1)
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { sessionId?: string } | null
  const sessionId = body?.sessionId
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })

  const files = await listChunks(sessionId)
  if (files.length === 0) return NextResponse.json({ error: "No chunks found" }, { status: 400 })

  // Get preview from first ~5MB only (fast path for large files)
  const previewBuffer = trimToCompleteLines(await readChunksSlice(sessionId, PREVIEW_MAX_BYTES))
  const preview = parseCsvPreview(previewBuffer.toString("utf8"), 100)

  const parts: Buffer[] = []
  for (const f of files) {
    parts.push(await readChunk(sessionId, f))
  }
  const assembled = Buffer.concat(parts)
  await writeAssembled(sessionId, assembled)

  return NextResponse.json({ sessionId, preview })
}

// Convenience: allow GET /finalize?sessionId=... to fetch preview after done
export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get("sessionId")
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })

  // Fast path: read only first ~5MB. If assembled exists, read from it; else from first chunks.
  const assembledSlice = await readAssembledSlice(sessionId, PREVIEW_MAX_BYTES)
  let previewBuffer: Buffer
  if (assembledSlice) {
    previewBuffer = trimToCompleteLines(assembledSlice)
  } else {
    const files = await listChunks(sessionId).catch(() => [])
    if (files.length === 0) return NextResponse.json({ error: "No chunks found" }, { status: 400 })
    previewBuffer = trimToCompleteLines(await readChunksSlice(sessionId, PREVIEW_MAX_BYTES))
  }

  const preview = parseCsvPreview(previewBuffer.toString("utf8"), 100)
  return NextResponse.json({ sessionId, preview })
}

