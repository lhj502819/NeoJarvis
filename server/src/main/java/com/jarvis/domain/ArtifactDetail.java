package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Persistence view of a single artifact with its content, backing
 * {@code GET /api/artifact/{id}} and {@code PATCH /api/artifact/{id}}. {@code version} is
 * carried so the intelligence-layer callers (tools.ts pin/update, brain.ts pinned context)
 * can render {@code v{version}} — the old TS chat route did not select it, but those
 * internal reads did.
 *
 * <p>v0.3 file-store change: {@code content} is now the LEGACY TEXT column, only populated
 * for rows created before the migration. New rows have {@code content=NULL} and
 * {@code uri} pointing at a local file (see {@link com.jarvis.util.ArtifactStore}). The
 * response layer decides which one to send back so old data keeps working — new callers
 * read the file via the URI (front-end adapter or Node fs).
 *
 * <p>{@code @JsonInclude(NON_NULL)} keeps the wire shape {@code content XOR uri} — the
 * null field is dropped instead of serialised as {@code null}. Directly returned by the
 * PATCH endpoint so it inherits the same rule as {@link ArtifactDetailResponse}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ArtifactDetail(
        String id,
        String type,
        String title,
        String content,
        String uri,
        String language,
        int version) {
}
