package com.jarvis.domain;

import java.util.List;
import java.util.Map;

/**
 * API-shaped agent recipe (matches TS {@code AgentRecipe}). {@code tools}/{@code skills}
 * are JSON arrays and {@code context} a JSON object in the DB; the service parses the
 * raw TEXT columns from {@link RecipeRow} into these typed fields.
 */
public record AgentRecipe(
        String id,
        String name,
        String description,
        String systemPrompt,
        List<String> tools,
        List<String> skills,
        String model,
        Map<String, Object> context,
        boolean persistent,
        int usageCount,
        String createdBy,
        String createdAt,
        String lastUsedAt) {
}
