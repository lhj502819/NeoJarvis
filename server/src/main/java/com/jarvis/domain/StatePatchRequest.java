package com.jarvis.domain;

/**
 * Request body for {@code PATCH /api/state}. All fields optional — only non-null
 * fields are applied over the current state ("body 只更新传入字段").
 */
public record StatePatchRequest(
        Integer mood,
        Integer energy,
        Integer confidence,
        Integer tasksCompletedToday,
        Integer messagesHandledToday,
        String lastInteractionAt,
        String lastDayReset,
        Integer familiarity,
        Integer trustLevel) {
}
