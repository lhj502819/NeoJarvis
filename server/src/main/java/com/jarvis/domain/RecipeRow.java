package com.jarvis.domain;

/**
 * Persistence view of a row in {@code jarvis_recipes}. {@code tools}/{@code skills}/
 * {@code context} are raw JSON TEXT; {@code persistent} is an INT flag (0/1). The
 * service converts these into the typed {@link AgentRecipe}.
 */
public record RecipeRow(
        String id,
        String name,
        String description,
        String systemPrompt,
        String tools,
        String model,
        String context,
        int persistent,
        int usageCount,
        String createdBy,
        String createdAt,
        String lastUsedAt,
        String skills) {
}
