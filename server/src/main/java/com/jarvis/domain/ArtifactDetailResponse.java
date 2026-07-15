package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Response body for {@code GET /api/artifact/{id}}: {@code { code: 0, ...artifact }}.
 *
 * <p>v0.3 file-store change: the shape is {@code content OR uri}, never both.
 * <ul>
 *   <li>New rows (uri present): {@code content} is omitted (null → JSON drops it); the
 *       front-end adapter reads the file via IPC or HTTP.</li>
 *   <li>Legacy rows (uri absent, content present): {@code content} is echoed back;
 *       {@code uri} is omitted. This is the backwards-compat path — pre-migration
 *       artifacts stay readable without any DB backfill.</li>
 * </ul>
 * {@code @JsonInclude(NON_NULL)} keeps the wire shape XOR — the unused field is dropped
 * instead of serialised as {@code null}, so front-end typeof checks stay clean.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ArtifactDetailResponse(
        int code,
        String id,
        String type,
        String title,
        String content,
        String uri,
        String language,
        int version) {

    public static ArtifactDetailResponse ok(ArtifactDetail a) {
        // Prefer uri (new rows) — clear content so the JSON shape is content XOR uri;
        // if only content is set (legacy row), pass it through with uri=null.
        boolean hasUri = a.uri() != null && !a.uri().isBlank();
        String content = hasUri ? null : a.content();
        String uri = hasUri ? a.uri() : null;
        return new ArtifactDetailResponse(0, a.id(), a.type(), a.title(), content, uri,
                a.language(), a.version());
    }
}
