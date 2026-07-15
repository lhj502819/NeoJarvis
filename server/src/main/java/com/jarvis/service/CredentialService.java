package com.jarvis.service;

import com.jarvis.domain.CreateCredentialRequest;
import com.jarvis.domain.Credential;
import com.jarvis.domain.CredentialRow;
import com.jarvis.domain.ResolvedCredential;
import com.jarvis.domain.UpdateCredentialRequest;
import com.jarvis.mapper.CredentialMapper;
import com.jarvis.util.CryptoUtil;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * BYOK credential management. Ports src/auth/credentials.ts, including the default-flag
 * bookkeeping: the first credential is forced default, setting a new default clears the
 * others, and deleting the current default promotes the earliest-created remaining one.
 * The api key is AES-GCM encrypted via {@link CryptoUtil} before storage and NEVER
 * returned — every method hands back the redacted {@link Credential} view.
 */
@Service
public class CredentialService {

    private static final Logger log = LoggerFactory.getLogger(CredentialService.class);

    private final CredentialMapper credentialMapper;

    public CredentialService(CredentialMapper credentialMapper) {
        this.credentialMapper = credentialMapper;
    }

    @Transactional(readOnly = true)
    public List<Credential> list(String userId) {
        log.debug("list_credentials userId={}", userId);
        return credentialMapper.listSafeByUser(userId);
    }

    /**
     * Resolve the credential to run an agent with, returning the DECRYPTED key. Ports
     * src/auth/credentials.ts#resolveCredential: when a tier is given, that tier's default
     * wins (else any of that tier); with no tier or no tier match, fall back to the user's
     * default credential. Decryption failure is a graceful degrade — log a warning (never
     * the plaintext) and return empty, so the caller falls back to the platform default key.
     *
     * <p>INTERNAL ONLY: returns a plaintext api key and must only be reached via
     * X-Internal-User / dev-bypass (single-machine mode). It must never be exposed to the
     * public internet. Under the eventual keychain architecture (Plan B) this resolution
     * moves to the client and this endpoint goes away.
     */
    @Transactional(readOnly = true)
    public Optional<ResolvedCredential> resolve(String userId, String tier) {
        Optional<CredentialRow> row = Optional.empty();
        if (tier != null && !tier.isEmpty()) {
            row = credentialMapper.findResolvableByTier(userId, tier);
        }
        if (row.isEmpty()) {
            row = credentialMapper.findResolvableDefault(userId);
        }
        if (row.isEmpty()) {
            return Optional.empty();
        }
        CredentialRow r = row.get();
        try {
            return Optional.of(new ResolvedCredential(CryptoUtil.decrypt(r.apiKeyEnc()),
                    r.baseUrl(), r.model()));
        } catch (RuntimeException e) {
            log.warn("resolve_credential decrypt failed userId={} — credential corrupt or key "
                    + "rotated, falling back to platform default", userId);
            return Optional.empty();
        }
    }

    @Transactional
    public Credential add(String userId, CreateCredentialRequest req) {
        // First credential is always default; or default when explicitly requested.
        boolean makeDefault = Boolean.TRUE.equals(req.isDefault())
                || credentialMapper.countByUser(userId) == 0;
        if (makeDefault) {
            credentialMapper.clearDefault(userId);
        }
        String now = Instant.now().toString();
        String id = UUID.randomUUID().toString();
        credentialMapper.insert(id, userId, req.label(), req.tier(), CryptoUtil.encrypt(req.apiKey()),
                req.baseUrl(), req.model(), makeDefault ? 1 : 0, now, now);
        log.debug("add_credential userId={} id={} default={}", userId, id, makeDefault);
        return new Credential(id, userId, req.label(), req.tier(), req.baseUrl(), req.model(),
                makeDefault, now, now);
    }

    @Transactional
    public Optional<Credential> update(String userId, String id, UpdateCredentialRequest req) {
        Optional<CredentialRow> existing = credentialMapper.findByIdAndUser(id, userId);
        if (existing.isEmpty()) {
            return Optional.empty();
        }
        CredentialRow row = existing.get();
        if (Boolean.TRUE.equals(req.isDefault())) {
            credentialMapper.clearDefault(userId);
        }
        // Null field keeps the stored value (TS ??). Blank/null apiKey keeps the existing
        // encrypted key so an empty value never clobbers a real one.
        String label = req.label() != null ? req.label() : row.label();
        String tier = req.tier() != null ? req.tier() : row.tier();
        String baseUrl = req.baseUrl() != null ? req.baseUrl() : row.baseUrl();
        String model = req.model() != null ? req.model() : row.model();
        String apiKeyEnc = (req.apiKey() != null && !req.apiKey().isEmpty())
                ? CryptoUtil.encrypt(req.apiKey()) : row.apiKeyEnc();
        boolean isDefault = Boolean.TRUE.equals(req.isDefault()) || row.isDefault();
        String now = Instant.now().toString();
        credentialMapper.update(id, userId, label, tier, apiKeyEnc, baseUrl, model,
                isDefault ? 1 : 0, now);
        log.debug("update_credential userId={} id={}", userId, id);
        return Optional.of(new Credential(id, userId, label, tier, baseUrl, model, isDefault,
                row.createdAt(), now));
    }

    @Transactional
    public boolean delete(String userId, String id) {
        Optional<CredentialRow> existing = credentialMapper.findByIdAndUser(id, userId);
        if (existing.isEmpty()) {
            return false;
        }
        credentialMapper.delete(id, userId);
        // Deleting the default while others remain -> promote the earliest-created one.
        if (existing.get().isDefault()) {
            credentialMapper.findEarliestId(userId)
                    .ifPresent(nextId -> credentialMapper.setDefault(nextId, userId));
        }
        log.debug("delete_credential userId={} id={}", userId, id);
        return true;
    }
}
