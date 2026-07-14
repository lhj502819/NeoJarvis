package com.jarvis.domain;

/**
 * Persistence view of a row in {@code jarvis_claude_sessions}. {@code topics} is raw
 * JSON TEXT (parsed by the service). The extra auto-increment {@code id} and
 * {@code user_id} columns are ignored by MyBatis auto-mapping.
 */
public record SessionRow(
        String sessionId,
        String recipeId,
        String domain,
        String cwd,
        String topics,
        String lastTaskDescription,
        String completedAt,
        int taskCount) {
}
