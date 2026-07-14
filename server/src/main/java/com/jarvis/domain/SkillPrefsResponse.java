package com.jarvis.domain;

import java.util.List;

/** Response for {@code GET /api/skills/prefs}: names the user has disabled (blacklist). */
public record SkillPrefsResponse(List<String> disabled) {
}
