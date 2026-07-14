package com.jarvis.domain;

import jakarta.validation.constraints.NotNull;

/**
 * Body for {@code POST /api/skills/{name}/toggle}. {@code enabled=true} removes the
 * blacklist row, {@code false} inserts it (mirrors the TS setSkillEnabled).
 */
public record SkillToggleRequest(@NotNull Boolean enabled) {
}
