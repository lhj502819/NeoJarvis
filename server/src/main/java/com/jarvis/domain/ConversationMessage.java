package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * One user↔Jarvis message for {@code GET /api/conversation}. {@code artifact} and
 * {@code imageIds} are omitted when absent (mirrors the TS {@code undefined} fields).
 *
 * <p>{@code id} 是 user_jarvis_messages 的 SERIAL 主键,TS 侧用它去关联 tool_traces。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ConversationMessage(
        long id,
        String role,
        String content,
        long timestamp,
        ArtifactRef artifact,
        List<String> imageIds) {
}
