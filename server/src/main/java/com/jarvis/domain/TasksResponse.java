package com.jarvis.domain;

import java.util.List;

/**
 * Response body for {@code GET /api/tasks} — matches the TS dashboard route
 * {@code { summary, tasks }} shape.
 */
public record TasksResponse(String summary, List<Task> tasks) {
}
