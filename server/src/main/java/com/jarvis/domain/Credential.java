package com.jarvis.domain;

/**
 * Redacted credential view (never carries {@code apiKey}). Field set matches the TS
 * {@code Credential} interface in src/auth/credentials.ts.
 */
public record Credential(
        String id,
        String userId,
        String label,
        String tier,
        String baseUrl,
        String model,
        boolean isDefault,
        String createdAt,
        String updatedAt) {
}
