package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.CreateCredentialRequest;
import com.jarvis.domain.Credential;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.ResolvedCredential;
import com.jarvis.domain.UpdateCredentialRequest;
import com.jarvis.service.CredentialService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/credentials")
class CredentialController {

    private final CredentialService credentialService;

    CredentialController(CredentialService credentialService) {
        this.credentialService = credentialService;
    }

    /** GET /api/credentials — redacted list (never includes apiKey). */
    @GetMapping
    List<Credential> list() {
        return credentialService.list(UserContext.currentUserId());
    }

    /**
     * GET /api/credentials/resolved?tier={tier} — resolve the credential to run an agent
     * with, returning the DECRYPTED {apiKey, baseUrl, model}; 404 {@code {error:"无可用凭证"}}
     * when nothing resolves (or decryption fails), which the caller treats as "fall back to
     * the platform default key".
     *
     * <p>SECURITY — INTERNAL ENDPOINT: this returns a PLAINTEXT api key and is reachable only
     * via X-Internal-User / dev-bypass (single-machine mode). It MUST NOT be exposed to the
     * public internet. Under the eventual keychain architecture (Plan B) this resolution moves
     * to the client and this endpoint is removed.
     */
    @GetMapping("/resolved")
    ResolvedCredential resolved(@RequestParam(required = false) String tier) {
        return credentialService.resolve(UserContext.currentUserId(), tier)
                .orElseThrow(() -> new NotFoundException("无可用凭证"));
    }

    /** POST /api/credentials — create; api key is encrypted before storage. */
    @PostMapping
    Credential create(@Valid @RequestBody CreateCredentialRequest request) {
        return credentialService.add(UserContext.currentUserId(), request);
    }

    /** PUT /api/credentials/{id} — update; 404 {@code {error:"凭证不存在"}} when missing. */
    @PutMapping("/{id}")
    Credential update(@PathVariable String id, @RequestBody UpdateCredentialRequest request) {
        return credentialService.update(UserContext.currentUserId(), id, request)
                .orElseThrow(() -> new NotFoundException("凭证不存在"));
    }

    /** DELETE /api/credentials/{id} — {@code {ok:true}}, 404 when missing. */
    @DeleteMapping("/{id}")
    OkResponse delete(@PathVariable String id) {
        if (!credentialService.delete(UserContext.currentUserId(), id)) {
            throw new NotFoundException("凭证不存在");
        }
        return new OkResponse(true);
    }
}
