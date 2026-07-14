package com.jarvis.domain;

/**
 * Body for {@code PATCH /api/task/{id}} (mirrors TS updateTask). All fields optional —
 * only the non-null ones are applied over the current task ("body 只更新传入字段").
 */
public record UpdateTaskRequest(
        String status,
        String plan,
        String result,
        String error) {
}
