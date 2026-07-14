package com.jarvis.domain;

/**
 * Success body for {@code /api/auth/register|login|me}. Superset of the TS shapes
 * ({@code {userId, username, displayName}} for register/login, {@code {userId, username,
 * role}} for me) — the web client (web/src/api/auth.ts) reads {@code userId/username/
 * displayName} and ignores extras, so one fully-populated record serves all three.
 */
public record AuthResponse(
        String userId,
        String username,
        String displayName,
        String role) {
}
