package com.jarvis.domain;

/**
 * Full persistence view of a {@code jarvis_user_credentials} row, including the
 * encrypted key. Internal only — never serialized to clients (use {@link Credential}).
 */
public record CredentialRow(
        String id,
        String userId,
        String label,
        String tier,
        String apiKeyEnc,
        String baseUrl,
        String model,
        boolean isDefault,
        String createdAt,
        String updatedAt) {
}
