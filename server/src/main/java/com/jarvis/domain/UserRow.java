package com.jarvis.domain;

/**
 * Full persistence view of a {@code jarvis_users} row, including the password hash and
 * salt. Internal only — never serialized to clients (use {@link User} for safe views).
 * Field set matches the TS {@code User} interface in src/auth/users.ts.
 */
public record UserRow(
        String id,
        String username,
        String displayName,
        String passwordHash,
        String salt,
        String role,
        String createdAt) {
}
