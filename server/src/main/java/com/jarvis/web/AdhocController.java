package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.AdhocAgent;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.UpsertAdhocRequest;
import com.jarvis.service.AdhocService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Adhoc (temporary) agent aggregate endpoints (ports src/a2a/adhoc.ts). */
@RestController
@RequestMapping("/api/adhoc")
class AdhocController {

    private final AdhocService adhocService;

    AdhocController(AdhocService adhocService) {
        this.adhocService = adhocService;
    }

    /** GET /api/adhoc — active (non-promoted) agents, busiest first. */
    @GetMapping
    List<AdhocAgent> list() {
        return adhocService.list(UserContext.currentUserId());
    }

    /** GET /api/adhoc/{domain} — single aggregate; 404 when the domain has none. */
    @GetMapping("/{domain}")
    AdhocAgent get(@PathVariable String domain) {
        return adhocService.get(UserContext.currentUserId(), domain)
                .orElseThrow(() -> new NotFoundException("adhoc agent 不存在"));
    }

    /** POST /api/adhoc — upsert by (user, domain); returns the resulting aggregate. */
    @PostMapping
    AdhocAgent upsert(@Valid @RequestBody UpsertAdhocRequest request) {
        return adhocService.upsert(UserContext.currentUserId(), request);
    }

    /** POST /api/adhoc/{domain}/promoted — flag the domain promoted; {@code {ok:true}}. */
    @PostMapping("/{domain}/promoted")
    OkResponse markPromoted(@PathVariable String domain) {
        adhocService.markPromoted(UserContext.currentUserId(), domain);
        return new OkResponse(true);
    }
}
