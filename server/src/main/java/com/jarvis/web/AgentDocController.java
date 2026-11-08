package com.jarvis.web;

import com.fasterxml.jackson.databind.JsonNode;
import com.jarvis.auth.UserContext;
import com.jarvis.domain.AgentDocListResponse;
import com.jarvis.domain.AgentDocUpsertRequest;
import com.jarvis.domain.OkResponse;
import com.jarvis.service.AgentDocService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Generic document store REST surface (docs/superagent-design-v2.md P0) — the TS side's
 * {@code shared/docs.ts} talks to these routes. Every path is user-scoped via the internal
 * user header; {@code kind} namespaces one concern per value (task-origin, message-origin,
 * timeline, comms, ...). GET one returns the stored JSON body directly; a missing doc is a 404.
 */
@RestController
@RequestMapping("/api/docs")
class AgentDocController {

    private final AgentDocService agentDocService;

    AgentDocController(AgentDocService agentDocService) {
        this.agentDocService = agentDocService;
    }

    @GetMapping("/{kind}")
    AgentDocListResponse list(@PathVariable String kind,
            @RequestParam(required = false, defaultValue = "") String prefix,
            @RequestParam(required = false) Integer limit) {
        return agentDocService.list(UserContext.currentUserId(), kind, prefix, limit);
    }

    @GetMapping("/{kind}/{key}")
    JsonNode get(@PathVariable String kind, @PathVariable String key) {
        return agentDocService.get(UserContext.currentUserId(), kind, key);
    }

    @PutMapping("/{kind}/{key}")
    OkResponse put(@PathVariable String kind, @PathVariable String key,
            @RequestBody AgentDocUpsertRequest request) {
        agentDocService.put(UserContext.currentUserId(), kind, key, request.data());
        return new OkResponse(true);
    }

    @DeleteMapping("/{kind}/{key}")
    OkResponse delete(@PathVariable String kind, @PathVariable String key) {
        boolean removed = agentDocService.delete(UserContext.currentUserId(), kind, key);
        return new OkResponse(removed);
    }
}
