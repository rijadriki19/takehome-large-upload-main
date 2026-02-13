"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import type { PreviewResponse } from "@/lib/types"

export default function DataPreviewTable() {
  const [data, setData] = useState<PreviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const searchParams = useSearchParams()
  const sessionId = searchParams.get("sessionId")

  useEffect(() => {
    if (!sessionId) return
    ;(async () => {
      try {
        setError(null)
        setData(null)
        setLoading(true)
        const res = await fetch(`/api/upload/finalize?sessionId=${encodeURIComponent(sessionId)}`, { method: "GET" })
        if (!res.ok) {
          setError(`Failed to load preview (${res.status})`)
          return
        }
        const json = (await res.json()) as PreviewResponse
        setData(json)
      } catch (err: any) {
        setError(err?.message ?? "Failed to load preview")
      } finally {
        setLoading(false)
      }
    })()
  }, [sessionId])

  if (!sessionId) {
    return (
      <div style={{ color: "#666", fontSize: 13 }}>
        Missing <code>sessionId</code>. Go back to the upload step and use the <b>“Go to preview”</b> button after a
        successful upload.
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ color: "#b91c1c", fontSize: 13 }}>
        <div style={{ fontWeight: 600 }}>Unable to load preview</div>
        <div>{error}</div>
        <div style={{ marginTop: 4 }}>
          If this keeps happening, try re-uploading the file and then opening the preview again.
        </div>
      </div>
    )
  }

  if (!data || loading) {
    return (
      <div style={{ color: "#666", fontSize: 13 }}>
        Preparing a small preview of your data… This only reads the first rows, not the entire file.
      </div>
    )
  }

  const { columns, types, rows } = data.preview

  const totalColumns = columns.length
  const totalRows = rows.length

  // To keep the table readable while still supporting wide datasets,
  // show up to 100 columns in the row preview and give the inner table
  // extra width so each column has room. The outer card stays the same
  // width and scrolls horizontally.
  const MAX_PREVIEW_COLUMNS = 100
  const previewColumns = columns.slice(0, MAX_PREVIEW_COLUMNS)
  const hasHiddenColumns = totalColumns > previewColumns.length
  const tableMinWidth = previewColumns.length * 140

  const inferredIssues = (() => {
    const issues: string[] = []
    const emptyCounts: Record<string, number> = {}

    for (const col of columns) {
      let empty = 0
      for (const row of rows) {
        const v = row[col]
        if (v === "" || v == null) empty++
      }
      //Count how many empty cells each column has.
      emptyCounts[col] = empty
    }

    const mostlyEmptyCols = columns.filter((c) => totalRows > 0 && emptyCounts[c]! / totalRows > 0.5) //Filter out columns that are mostly empty. ex: more
    if (mostlyEmptyCols.length > 0) {
      issues.push(
        `Some columns are mostly empty in the first ${totalRows} rows: ` +
          `${mostlyEmptyCols.slice(0, 5).join(", ")}${mostlyEmptyCols.length > 5 ? ", …" : ""}.`,
      )
    }

    const unknownTypeCols = columns.filter((c) => types[c] === "unknown")
    if (unknownTypeCols.length > 0) {
      issues.push(
        `We could not confidently infer a type for: ` +
          `${unknownTypeCols.slice(0, 5).join(", ")}${unknownTypeCols.length > 5 ? ", …" : ""}.`,
      )
    }

    return issues
  })()//IIFE = Immediately Invoked Function Expression - call right away

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: 12,
          background: "#f9fafb",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 650 }}>Dataset overview</div>
        <div style={{ fontSize: 13, color: "#4b5563" }}>
          <span style={{ marginRight: 12 }}>
            <b>{totalColumns}</b> columns
          </span>
          <span>
            <b>{totalRows}</b> preview rows
          </span>
        </div>
        {inferredIssues.length > 0 && (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12, color: "#b45309" }}>
            {inferredIssues.map((issue, idx) => (
              <li key={idx}>{issue}</li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12 }}>
        <div style={{ fontWeight: 650, marginBottom: 6 }}>Columns</div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            maxHeight: 160,
            overflowY: "auto",
          }}
        >
          {columns.map((c) => (
            <span
              key={c}
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                background: "#f3f4f6",
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              <b>{c}</b>{" "}
              <span style={{ color: "#6b7280" }}>
                ({types[c] ?? "unknown"})
              </span>
            </span>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280" }}>
          Scroll if the column list is long. This view is just a quick sanity check, not a full data browser.
        </div>
      </div>

      <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12,maxWidth:'1073px' }}>
        <div style={{ fontWeight: 650, marginBottom: 4 }}>Rows (first {totalRows})</div>
        {hasHiddenColumns && (
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
            Showing the first {previewColumns.length} of {totalColumns} columns to keep this preview readable. All columns
            are listed in the section above.
          </div>
        )}

        <div
          style={{
            overflowX: "auto",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            maxWidth: "100%",
          }}
        >
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              fontSize: 12,
              tableLayout: "fixed",
              minWidth: tableMinWidth,
            }}
          >
            <thead>
              <tr>
                {previewColumns.map((c) => (
                  <th
                    key={c}
                    style={{
                      textAlign: "left",
                      padding: 6,
                      borderBottom: "1px solid #e5e7eb",
                      whiteSpace: "nowrap",
                      position: "sticky",
                      top: 0,
                      background: "#f9fafb",
                      zIndex: 1,
                    }}
                    title={c}
                  >
                    {c}
                    <span style={{ display: "block", fontSize: 10, color: "#6b7280" }}>{types[c] ?? "unknown"}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} style={{ background: idx % 2 === 0 ? "#ffffff" : "#f9fafb" }}>
                  {previewColumns.map((c) => {
                    const value = r[c]
                    const isEmpty = value === "" || value == null
                    return (
                      <td
                        key={c}
                        style={{
                          padding: 6,
                          borderBottom: "1px solid #f3f4f6",
                          whiteSpace: "nowrap",
                          color: isEmpty ? "#9ca3af" : "#111827",
                          fontStyle: isEmpty ? "italic" : "normal",
                        }}
                        title={isEmpty ? "(empty)" : String(value)}
                      >
                        {isEmpty ? "∅" : String(value)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
          This is a lightweight preview for sanity-checking columns, types, and obvious data issues. Wide datasets can
          be viewed by scrolling horizontally.
        </div>
      </div>
    </div>
  )
}

