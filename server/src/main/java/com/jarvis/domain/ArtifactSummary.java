package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * Artifact summary embedded in {@link TaskDetail} (matches the TS getTaskDetail
 * artifacts shape). {@code createdAt} is an epoch-millis BIGINT column.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ArtifactSummary(
        String id,
        String type,
        String title,
        String language,
        int version,
        long createdAt) {
}
