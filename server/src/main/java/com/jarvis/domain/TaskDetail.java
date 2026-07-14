package com.jarvis.domain;

import java.util.List;
import java.util.Map;

/**
 * Aggregated task view (matches TS {@code TaskDetail}). {@code conversation} is
 * intentionally serialised even when null to mirror the TS shape, so this record
 * is NOT annotated {@code @JsonInclude(NON_NULL)}. A2 has no A2A bus yet, so
 * {@code messagesBySubtask} entries are empty lists and {@code conversation} is null.
 */
public record TaskDetail(
        Task task,
        Map<String, List<SubTaskTurn>> turnsBySubtask,
        Map<String, List<Object>> messagesBySubtask,
        Object conversation,
        List<ArtifactSummary> artifacts) {
}
