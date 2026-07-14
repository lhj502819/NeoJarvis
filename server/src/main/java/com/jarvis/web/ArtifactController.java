package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.ArtifactCreatedResponse;
import com.jarvis.domain.ArtifactDetailResponse;
import com.jarvis.domain.ArtifactListResponse;
import com.jarvis.domain.CodeMessage;
import com.jarvis.domain.SaveArtifactRequest;
import com.jarvis.service.ArtifactService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
class ArtifactController {

    private final ArtifactService artifactService;

    ArtifactController(ArtifactService artifactService) {
        this.artifactService = artifactService;
    }

    /** GET /api/artifacts — filtered, paged summary list {@code { total, items }}. */
    @GetMapping("/artifacts")
    ArtifactListResponse list(@RequestParam(required = false) String type,
            @RequestParam(required = false) String q,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset) {
        return artifactService.list(UserContext.currentUserId(), type, q, limit, offset);
    }

    /**
     * GET /api/artifact/{id} — detail with content. Mirrors the TS chat route exactly:
     * present -> {@code { code: 0, ...artifact }}, missing -> 404 {@code { code: 404,
     * message: "制品不存在" }} (its own body shape, not the global {@code { error }}).
     */
    @GetMapping("/artifact/{id}")
    ResponseEntity<?> detail(@PathVariable String id) {
        return artifactService.getDetail(UserContext.currentUserId(), id)
                .<ResponseEntity<?>>map(a -> ResponseEntity.ok(ArtifactDetailResponse.ok(a)))
                .orElseGet(() -> ResponseEntity.status(404).body(new CodeMessage(404, "制品不存在")));
    }

    /**
     * POST /api/artifacts — store a new artifact, return {@code { id }} (ports the internal
     * TS saveArtifact, which A3's read-only pass deliberately skipped). Not present in the
     * old TS HTTP layer, so no legacy response shape to mirror.
     */
    @PostMapping("/artifacts")
    ArtifactCreatedResponse create(@Valid @RequestBody SaveArtifactRequest request) {
        String id = artifactService.saveArtifact(UserContext.currentUserId(), request);
        return new ArtifactCreatedResponse(id);
    }
}
