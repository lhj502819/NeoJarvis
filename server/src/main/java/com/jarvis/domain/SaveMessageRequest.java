package com.jarvis.domain;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;

/**
 * Body for {@code POST /api/conversation/messages} (ports the TS {@code addToBuffer}).
 * {@code role} is constrained to the two values the TS layer uses; {@code artifactId} and
 * {@code imageIds} are optional (an absent/empty list stores NULL, mirroring TS).
 */
public record SaveMessageRequest(
        @NotNull @Pattern(regexp = "user|jarvis", message = "role must be 'user' or 'jarvis'")
        String role,
        @NotNull String content,
        String artifactId,
        List<String> imageIds) {
}
