"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useCallback } from "react"
import { useChunkedUpload } from "@/hooks/useChunkedUpload"

function formatBytes(n: number) {
  const units = ["B", "KB", "MB", "GB"]
  let i = 0
  let x = n
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024
    i++
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function UploadWizard() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [validationStatus, setValidationStatus] = useState<"idle" | "running" | "passed" | "failed">("idle")
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  const {
    status,
    progress,
    error,
    start,
    cancel,
    reset,
    sessionId,
  } = useChunkedUpload()

  const canStart =
    !!file &&
    validationStatus === "passed" &&
    (status === "idle" || status === "error" || status === "canceled" || status === "done")
  const isBusy = status === "initializing" || status === "uploading" || status === "finalizing"

 const runValidation = useCallback(async (nextFile: File) => {
  setValidationStatus("running")
  setValidationMessage("Checking that this looks like a CSV we can safely upload…")

  try {
    const lowerName = nextFile.name.toLowerCase()
    if (!lowerName.endsWith(".csv")) {
      setValidationStatus("failed")
      setValidationMessage("This file does not have a .csv extension. Please choose a CSV file.")
      return
    }

    const firstChunk = await nextFile.slice(0, 200_000).text()
    const lines = firstChunk.split(/\r?\n/).filter(Boolean)

    if (lines.length < 2) {
      setValidationStatus("failed")
      setValidationMessage("CSV must contain a header row and at least one data row.")
      return
    }

    const headers = lines[0].split(",").map(h => h.trim())
    const expectedColumnCount = headers.length

    // Empty header names
    const emptyHeaders = headers.filter(h => h === "")
    if (emptyHeaders.length > 0) {
      setValidationStatus("failed")
      setValidationMessage("One or more column headers are empty. Please provide names for all columns.")
      return
    }

    // Duplicate headers
    const seen = new Set<string>()
    const duplicates: string[] = []

    for (const h of headers) {
      if (seen.has(h)) duplicates.push(h)
      seen.add(h)
    }

    if (duplicates.length > 0) {
      setValidationStatus("failed")
      setValidationMessage(
        `Duplicate column names detected: ${[...new Set(duplicates)].join(", ")}. 
Please ensure all column headers are unique before uploading.`
      )
      return
    }

    // ----- ROW WIDTH VALIDATION (first 50 rows only) -----
    const MAX_ROWS_TO_CHECK = 50
    for (let i = 1; i < Math.min(lines.length, MAX_ROWS_TO_CHECK + 1); i++) {
      const rowColumns = lines[i].split(",")

      if (rowColumns.length !== expectedColumnCount) {
        setValidationStatus("failed")
        setValidationMessage(
          `Row ${i + 1} has ${rowColumns.length} columns, but the header defines ${expectedColumnCount}. 
Please ensure every row has exactly ${expectedColumnCount} columns.`
        )
        return
      }
    }

    const sizeMb = nextFile.size / (1024 * 1024)
    const sizeNote =
      sizeMb < 5
        ? "This is a small file, it should upload quickly."
        : sizeMb > 200
        ? "This is a very large file; it may take a while to upload."
        : "This is a typical size for large CSV uploads."

    setValidationStatus("passed")
    setValidationMessage(`File looks structurally valid (${expectedColumnCount} columns detected). ${sizeNote}`)
  } catch (_err) {
    setValidationStatus("failed")
    setValidationMessage(
      "We could not read this file in the browser. Please confirm it is a CSV and try selecting it again."
    )
  }
}, [])


  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const nextFile = e.target.files?.[0] ?? null
    setFile(nextFile)
    setValidationStatus("idle")
    setValidationMessage(null)

    if (nextFile) {
      // Clear any previous upload state so we have a clean run for this file.
      reset()
      // Do not wait for the promise result.
      void runValidation(nextFile)
    }
  }

  const fileInfo = useMemo(() => {
    if (!file) return null
    return `${file.name} • ${formatBytes(file.size)}`
  }, [file])

  const currentPhaseLabel = useMemo(() => {
    if (!file) return "Select a CSV file to begin."
    if (validationStatus === "running") return "Validating the selected file."
    if (validationStatus === "failed") return "File validation failed. Please review the message below."
    if (status === "initializing") return "Setting up a secure upload session with the server."
    if (status === "uploading") return "Uploading the file in chunks. Please keep this tab open."
    if (status === "finalizing") return "Finalizing the upload and preparing a preview."
    if (status === "done") return "Upload complete. You can open the preview."
    if (status === "error") return "Upload failed. You can adjust and try again."
    if (status === "canceled") return "Upload canceled. You can restart when ready."
    return "Ready to start the upload when you are."
  }, [file, status, validationStatus])

  const phaseStepState = useMemo(() => {
    type StepState = "pending" | "active" | "done" | "error"

    const result: Record<
      "select" | "validate" | "upload" | "finalize" | "ready",
      StepState
    > = {
      select: "pending",
      validate: "pending",
      upload: "pending",
      finalize: "pending",
      ready: "pending",
    }

    if (!file) {
      result.select = "active"
      return result
    }

    // Select
    result.select = "done"

    // Validate
    if (validationStatus === "running" || validationStatus === "idle") {
      result.validate = "active"
    } else if (validationStatus === "passed") {
      result.validate = "done"
    } else if (validationStatus === "failed") {
      result.validate = "error"
      return result
    }

    // Upload + later phases only make sense once validation passed.
    if (validationStatus !== "passed") return result

    if (status === "initializing" || status === "uploading") {
      result.upload = "active"
    } else if (status === "finalizing" || status === "done") {
      result.upload = "done"
    } else if (status === "error" || status === "canceled") {
      result.upload = "error"
      return result
    }

    if (status === "finalizing") {
      result.finalize = "active"
    } else if (status === "done") {
      result.finalize = "done"
    }

    if (status === "done") {
      result.ready = "done"
    }

    return result
  }, [file, status, validationStatus])

  const renderStep = (label: string, description: string, state: "pending" | "active" | "done" | "error") => {
    const color =
      state === "done" ? "#14532d" : state === "active" ? "#111827" : state === "error" ? "#b91c1c" : "#6b7280"
    const dot =
      state === "done" ? "●" : state === "active" ? "●" : state === "error" ? "●" : "○"

    const statusLabel =
      state === "done"
        ? "Completed"
        : state === "active"
        ? "In progress"
        : state === "error"
        ? "Needs attention"
        : "Not started"

    return (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ fontSize: 12, lineHeight: "20px", color }}>{dot}</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color }}>
            {label} <span style={{ fontWeight: 400, color: "#6b7280" }}>({statusLabel})</span>
          </div>
          <div style={{ fontSize: 12, color: "#4b5563" }}>{description}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 12,
        padding: 16,
        background: "#f9fafb",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Upload a CSV in clear steps</div>
        <div style={{ fontSize: 13, color: "#4b5563" }}>{currentPhaseLabel}</div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={isBusy}
          onChange={handleFileChange}
        />
        <div style={{ color: "#444", fontSize: 13 }}>
          {fileInfo ?? "Choose a CSV from your computer (10–100MB is a typical range)."}
        </div>
      </div>

      {validationStatus !== "idle" && (
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 12,
            background:
              validationStatus === "passed"
                ? "#ecfdf3"
                : validationStatus === "running"
                ? "#eff6ff"
                : "#fef2f2",
            color:
              validationStatus === "passed"
                ? "#166534"
                : validationStatus === "running"
                ? "#1d4ed8"
                : "#b91c1c",
          }}
        >
          {validationMessage}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {renderStep(
            "1. Select",
            "Pick a CSV file from your computer.",
            phaseStepState.select,
          )}
          {renderStep(
            "2. Validate",
            "We quickly sanity-check the file before uploading.",
            phaseStepState.validate,
          )}
          {renderStep(
            "3. Upload (chunked)",
            "The file is uploaded in smaller pieces that can survive server limits.",
            phaseStepState.upload,
          )}
          {renderStep(
            "4. Finalize",
            "Chunks are stitched together and a preview is prepared.",
            phaseStepState.finalize,
          )}
          {renderStep(
            "5. Ready",
            "Once complete, you can open a safe preview of your data.",
            phaseStepState.ready,
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => file && start(file)}
              disabled={!canStart}
              style={{ padding: "8px 12px", borderRadius: 10 }}
            >
              Start upload
            </button>

            <button
              onClick={() => cancel()}
              disabled={!isBusy}
              style={{ padding: "8px 12px", borderRadius: 10 }}
            >
              Cancel
            </button>

            <button
              onClick={() => {
                reset()
                setFile(null)
                setValidationStatus("idle")
                setValidationMessage(null)
              }}
              style={{ padding: "8px 12px", borderRadius: 10 }}
            >
              Reset
            </button>

            <button
              onClick={() => router.push(`/preview?sessionId=${encodeURIComponent(sessionId ?? "")}`)}
              disabled={!sessionId || status !== "done"}
              style={{ padding: "8px 12px", borderRadius: 10 }}
            >
              Go to preview
            </button>
          </div>

          <div style={{ fontSize: 13, color: "#555" }}>
            <div>
              Overall progress: <b>{Math.round(progress * 100)}%</b>
            </div>
            {sessionId && (
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Session ID: <code>{sessionId.slice(0, 8)}…</code>
              </div>
            )}
          </div>

          <div style={{ background: "#e5e7eb", borderRadius: 999, height: 8, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: "100%",
                background: "#111827",
                transition: "width 120ms ease-out",
              }}
            />
          </div>

          {error && (
            <div style={{ marginTop: 4, color: "#b91c1c", fontSize: 12 }}>
              <div style={{ fontWeight: 600 }}>Upload problem</div>
              <div>{error}</div>
              <div style={{ marginTop: 4 }}>
                You can try again with <b>Reset</b>, then re-select the file and start the upload.
              </div>
            </div>
          )}

          <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>
            This demo uses basic sequential chunk uploads. The steps above are designed to make progress and issues easy
            to understand for non-technical users.
          </div>
        </div>
      </div>
    </div>
  )
}

