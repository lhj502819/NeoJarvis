package com.jarvis.domain;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * API-shaped task (matches TS {@code Task} in src/shared/types.ts).
 * Assembled by the service layer: persistence rows come from {@link TaskRow},
 * the {@code subtasks} list is loaded and enriched separately.
 * Null fields are omitted to mirror the TS {@code field || undefined} behaviour.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Task(
        String id,
        String name,
        String description,
        String status,
        String plan,
        List<SubTask> subtasks,
        String result,
        String error,
        String createdAt,
        String updatedAt) {
}
