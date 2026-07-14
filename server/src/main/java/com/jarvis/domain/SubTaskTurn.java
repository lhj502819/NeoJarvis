package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A single execution turn (matches TS {@code SubTaskTurn}). Maps 1:1 to a row in
 * {@code jarvis_subtask_turns}. {@code endedAt} is omitted when null (mirrors TS).
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SubTaskTurn(
        String id,
        String subtaskId,
        int turnIndex,
        String text,
        String startedAt,
        String endedAt,
        String createdAt) {
}
