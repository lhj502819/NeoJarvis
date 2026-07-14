package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;

/**
 * Body for {@code POST /api/credentials}. All fields required (mirrors the TS route's
 * "label、tier、apiKey、baseUrl、model 均为必填" check); {@code isDefault} optional.
 */
public record CreateCredentialRequest(
        @NotBlank String label,
        @NotBlank String tier,
        @NotBlank String apiKey,
        @NotBlank String baseUrl,
        @NotBlank String model,
        Boolean isDefault) {
}
