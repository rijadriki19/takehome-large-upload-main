# Decisions

## What Changed and Why

### Upload experience (UX)

- **Phase-based workflow:** Introduced explicit phases (Select → Validate → Upload → Finalize → Ready) so users always know what’s happening. Each phase shows a clear label (e.g. “Setting up a secure upload session”, “Uploading the file in chunks”, etc.).

- **Validation step:** Added client-side validation before upload (CSV extension check, readable slice). Fails fast and gives plain-language feedback instead of failing later during upload. Added 3 types of messages for <10MB, <100MB, >100MB (can be tweaked - do not allow >100MB).

- **Progress and state:** Replaced vague progress with a step-based UI and a progress bar. Success is shown only after `finalize` completes.

- **Error handling:** Errors are surfaced in a dedicated area with specific messages and next steps (retry via “Start upload” or “Reset” to choose a different file).

- **Helpers:** Introduce helpers for reading only first smaller chunk of data, for faster preview - do not wait finalize to assemble all data back. Loading big file into string may cause crashes.

### Client-side robustness

- **Explicit status model:** Replaced boolean flags with a single `Status` type (`idle | initializing | uploading | finalizing | done | error | canceled`). This avoids inconsistent state and makes transitions predictable.

- **Per-chunk retry with backoff:** Each chunk is retried up to 3 times with linear backoff (300ms, 600ms, 900ms). Ordering stays strict: we never advance past a chunk until it succeeds.

- **Partial failure:** On repeated chunk failure, we store `failedChunkIndex` so we can surface which chunk failed for future debugging or UX.

### Data preview

- **Wide datasets:** Added horizontal scroll, and a column list (with types). Supports up to 100 columns; extra columns are listed in the overview.

- **Clarity over completeness:** Preview shows first N rows and inferred types. Empty cells are shown as ∅ and styled for quick scanning.

---

## What Was Intentionally Not Done

- **Resumable uploads:** Would need backend support for partial session state. Skipped to stay within timebox and existing API.

- **Chunk-level progress by bytes:** Progress is chunk-based (X of Y chunks) because it matches current backend behavior and is simple. Bytes-based progress would need file size and chunk size passed through the UI.

- **Parallel chunk uploads:** Sequential uploads keep ordering and failure handling straightforward. Parallelism would require more complex orchestration and backend support for out-of-order chunks.

- **Pause upload:** Cancel exists; true pause/resume would need resumability and extra API support.

- **Design / UX/UI:** Mobile responsive site (Tailwind for example), site navigation. 404 for not found sessionId's

- **Preview list / optimization:** Could introduce tanstack virtaul list for better perforamce of list rendering, pagination missing.

-  **Some tasks that could be further implemented:** Backend APIs, database storage, some cache tool like redis, use mulitpart form-data.

---

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| Sequential chunk uploads | Simpler and robust; slower than parallel for fast connections. |
| Chunk-based progress | Easy to implement; slightly less accurate than byte-based. |
| Client-side validation only | Fast feedback; does not replace server-side validation. |
| Up to 100 columns in table | Readable for wide data; very wide tables still require scrolling, not all columns are visible. |
| No resumability | Shorter implementation; users must re-upload after refresh or close. |


