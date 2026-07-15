package com.jarvis.domain;

import jakarta.validation.constraints.NotNull;

/**
 * Body for {@code POST /api/mcp/{name}/toggle}. {@code enabled=true} removes the blacklist row,
 * {@code false} inserts it (mirrors the TS {@code setMcpEnabled}). Sibling of {@link SkillToggleRequest}.
 */
public record McpToggleRequest(@NotNull Boolean enabled) {
}
