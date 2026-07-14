package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;

/**
 * Body for {@code POST /api/recipes} (mirrors TS registry.ts createRecipe params).
 * {@code name}/{@code description}/{@code systemPrompt}/{@code tools} are required; the
 * rest are optional and fall back to the TS defaults in the service
 * ({@code skills=[]}, {@code model='sonnet'}, {@code context={}}, {@code persistent=false},
 * {@code createdBy='jarvis'}). {@code tools}/{@code skills} are string arrays and
 * {@code context} a free-form object, matching {@link AgentRecipe}.
 */
public record CreateRecipeRequest(
        @NotBlank String name,
        @NotBlank String description,
        @NotBlank String systemPrompt,
        @NotNull List<String> tools,
        List<String> skills,
        String model,
        Map<String, Object> context,
        Boolean persistent,
        String createdBy) {
}
