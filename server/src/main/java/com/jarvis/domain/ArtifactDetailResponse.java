package com.jarvis.domain;

/**
 * Response body for {@code GET /api/artifact/{id}}: {@code { code: 0, ...artifact }}
 * (mirrors the TS chat route {@code res.json({ code: 0, ...rows[0] })}).
 */
public record ArtifactDetailResponse(
        int code,
        String id,
        String type,
        String title,
        String content,
        String language,
        int version) {

    public static ArtifactDetailResponse ok(ArtifactDetail a) {
        return new ArtifactDetailResponse(0, a.id(), a.type(), a.title(), a.content(),
                a.language(), a.version());
    }
}
