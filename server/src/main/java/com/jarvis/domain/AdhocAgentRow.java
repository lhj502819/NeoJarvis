package com.jarvis.domain;

/**
 * Persistence view of a {@code jarvis_adhoc_agents} row. {@code topics} stays raw JSON
 * TEXT and {@code promoted} an INT 0/1; the service converts these to the typed
 * {@link AdhocAgent} fields (mirrors the RecipeRow -> AgentRecipe split).
 */
public record AdhocAgentRow(
        String id,
        String userId,
        String domain,
        int taskCount,
        String lastTaskDescription,
        String cwd,
        String topics,
        String lastSessionId,
        int promoted,
        String createdAt,
        String updatedAt) {
}
