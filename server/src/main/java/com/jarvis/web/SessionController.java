package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.AgentSession;
import com.jarvis.domain.RecordSessionRequest;
import com.jarvis.service.SessionService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Agent session registry endpoints (ports src/a2a/history.ts writes + domain/recipe lookups).
 * The listing of all sessions stays on {@code GET /api/history} (HistoryController); this
 * controller adds the upsert and the two scoped lookups the TS local matching consumes.
 */
@RestController
@RequestMapping("/api/sessions")
class SessionController {

    private final SessionService sessionService;

    SessionController(SessionService sessionService) {
        this.sessionService = sessionService;
    }

    /** POST /api/sessions — upsert a session (recordAgentSession); no body returned. */
    @PostMapping
    void record(@Valid @RequestBody RecordSessionRequest request) {
        sessionService.record(UserContext.currentUserId(), request);
    }

    /** GET /api/sessions/by-domain?domain= — sessions in a domain (getSessionsByDomain). */
    @GetMapping("/by-domain")
    List<AgentSession> byDomain(@RequestParam String domain) {
        return sessionService.byDomain(UserContext.currentUserId(), domain);
    }

    /** GET /api/sessions/match?recipeId= — a recipe's sessions; TS scores them locally. */
    @GetMapping("/match")
    List<AgentSession> match(@RequestParam String recipeId) {
        return sessionService.byRecipe(UserContext.currentUserId(), recipeId);
    }
}
