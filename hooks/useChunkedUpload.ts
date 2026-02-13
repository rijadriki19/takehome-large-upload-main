"use client"

import { useCallback, useRef, useState } from "react"
import type { UploadInitResponse } from "@/lib/types"

type Status = "idle" | "initializing" | "uploading" | "finalizing" | "done" | "error" | "canceled"

const DEFAULT_CHUNK_BYTES = 1024 * 1024 // 1MB
const MAX_CHUNK_RETRIES = 3

export function useChunkedUpload() {
  const [status, setStatus] = useState<Status>("idle")
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Diagnostics to make chunk orchestration and failures observable.
  const [totalChunks, setTotalChunks] = useState<number | null>(null)
  const [uploadedChunks, setUploadedChunks] = useState(0)
  const [failedChunkIndex, setFailedChunkIndex] = useState<number | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus("idle")
    setProgress(0)
    setError(null)
    setSessionId(null)
    setTotalChunks(null)
    setUploadedChunks(0)
    setFailedChunkIndex(null)
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus("canceled")
  }, [])

  const start = useCallback(async (file: File) => {
    // Guard against accidental double-starts while an upload is already active.
    if (status === "initializing" || status === "uploading" || status === "finalizing") {
      return
    }

    setError(null)
    setProgress(0)
    setStatus("initializing")
    setTotalChunks(null)
    setUploadedChunks(0)
    setFailedChunkIndex(null)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      // 1. Initialize a new upload session.
      const initRes = await fetch("/api/upload/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size }),
        signal: abort.signal,
      })
      if (!initRes.ok) throw new Error(`init failed (${initRes.status})`)
      const initJson = (await initRes.json()) as UploadInitResponse
      setSessionId(initJson.sessionId)
      localStorage.setItem("lastSessionId", initJson.sessionId)

      const chunkSize = DEFAULT_CHUNK_BYTES
      const total = Math.ceil(file.size / chunkSize)
      setTotalChunks(total)
      setStatus("uploading")

      // 2. Upload chunks sequentially with per-chunk retry.
      for (let chunkIndex = 0; chunkIndex < total; chunkIndex++) {
        const startByte = chunkIndex * chunkSize
        const endByte = Math.min(startByte + chunkSize, file.size)
        const blob = file.slice(startByte, endByte)
        const buf = await blob.arrayBuffer()

        let attempt = 0
        // Simple bounded retry loop with backoff.
        // This keeps ordering strict: we never move past a chunk until it succeeds.
        // If it still fails after MAX_CHUNK_RETRIES, we surface a clear, actionable error.
        // eslint-disable-next-line no-constant-condition
        while (true) {
          attempt++
          try {
            const chunkRes = await fetch("/api/upload/chunk", {
              method: "POST",
              headers: {
                "content-type": "application/octet-stream",
                "x-session-id": initJson.sessionId,
                "x-chunk-index": String(chunkIndex),
                "x-total-chunks": String(total),
              },
              body: buf,
              signal: abort.signal,
            })
            if (!chunkRes.ok) {
              throw new Error(`chunk ${chunkIndex + 1}/${total} failed (${chunkRes.status})`)
            }
            break
          } catch (err: any) {
            // If the user canceled, surface the abort rather than a generic error.
            if (err?.name === "AbortError") {
              throw err
            }

            if (attempt >= MAX_CHUNK_RETRIES) {
              setFailedChunkIndex(chunkIndex)
              throw new Error(
                `Chunk ${chunkIndex + 1} of ${total} failed after ${attempt} attempts. Last error: ${
                  err?.message ?? "unknown error"
                }`,
              )
            }

            // Basic linear backoff (e.g. 300ms, 600ms, 900ms).
            const delayMs = 300 * attempt
            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }
        }

        const completed = chunkIndex + 1
        setUploadedChunks(completed)
        // NOTE: progress stays chunk-based for now; bytes-based progress would be a natural extension.
        setProgress(completed / total)
      }

      // 3. Tell the backend to assemble and parse the file.
      setStatus("finalizing")

      const finRes = await fetch("/api/upload/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: initJson.sessionId }),
        signal: abort.signal,
      })
      if (!finRes.ok) throw new Error(`finalize failed (${finRes.status})`)

      setProgress(1)
      setStatus("done")
      abortRef.current = null
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // Status is managed by cancel/reset in this case.
        return
      }
      setStatus("error")
      setError(e?.message ?? "Upload failed")
      abortRef.current = null
    }
  }, [status])

  return {
    status,
    progress,
    error,
    start,
    cancel,
    reset,
    sessionId,
    totalChunks,
    uploadedChunks,
    failedChunkIndex,
  }
}

