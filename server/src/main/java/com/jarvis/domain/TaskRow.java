package com.jarvis.domain;

/**
 * Persistence view of a row in {@code jarvis_tasks}. Column names map to these
 * fields via MyBatis {@code map-underscore-to-camel-case}. The extra
 * {@code user_id} column returned by {@code SELECT *} is ignored.
 */
public record TaskRow(
        String id,
        String name,
        String description,
        String status,
        String plan,
        String result,
        String error,
        String createdAt,
        String updatedAt) {
}
