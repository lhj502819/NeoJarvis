package com.jarvis.domain;

/**
 * Safe user view (never carries {@code passwordHash} / {@code salt}). Used for admin
 * listings and any place a user record is returned to clients. Mirrors the TS
 * {@code Omit<User, 'passwordHash' | 'salt'>} shape from src/auth/users.ts listUsers().
 */
public record User(
        String id,
        String username,
        String displayName,
        String role,
        String createdAt) {
}
