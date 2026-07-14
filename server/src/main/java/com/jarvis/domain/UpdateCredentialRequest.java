package com.jarvis.domain;

/**
 * Body for {@code PUT /api/credentials/{id}}. All fields optional — a null field keeps
 * the stored value (mirrors the TS {@code ??} merge). A null/blank {@code apiKey} keeps
 * the existing encrypted key so an empty value never clobbers a real key.
 */
public record UpdateCredentialRequest(
        String label,
        String tier,
        String apiKey,
        String baseUrl,
        String model,
        Boolean isDefault) {
}
