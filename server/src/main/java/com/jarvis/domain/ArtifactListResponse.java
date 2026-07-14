package com.jarvis.domain;

import java.util.List;

/**
 * Response for {@code GET /api/artifacts}: {@code { total, items }} (mirrors the TS
 * dashboard route). {@code items} carry summaries only — never the artifact content.
 */
public record ArtifactListResponse(long total, List<ArtifactSummary> items) {
}
