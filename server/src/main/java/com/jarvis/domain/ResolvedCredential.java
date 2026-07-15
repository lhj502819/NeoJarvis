package com.jarvis.domain;

/**
 * Decrypted credential used by the intelligence layer to run agents. Carries the PLAINTEXT
 * {@code apiKey} — field set matches the TS {@code ResolvedCredential} interface in
 * src/auth/credentials.ts. Only ever returned from the internal resolve endpoint; never
 * exposed on the public list/create/update views (use {@link Credential} for those).
 */
public record ResolvedCredential(
        String apiKey,
        String baseUrl,
        String model) {
}
