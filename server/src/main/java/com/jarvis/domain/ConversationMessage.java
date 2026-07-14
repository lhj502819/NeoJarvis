package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * One user↔Jarvis message for {@code GET /api/conversation}. {@code artifact} and
 * {@code imageIds} are omitted when absent (mirrors the TS {@code undefined} fields).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ConversationMessage(
        String role,
        String content,
        long timestamp,
        ArtifactRef artifact,
        List<String> imageIds) {
}
