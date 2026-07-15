package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.AgentConversation;
import com.jarvis.domain.AgentMessage;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.RecordAgentMessageRequest;
import com.jarvis.service.AgentBusService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Jarvis↔Agent message-bus endpoints (backs the TS {@code MessageBus} DB layer). The
 * in-memory agent registry / inbox stays in the TS process; only the durable message log
 * lives here. All reads are global (never user-scoped), matching the old TS bus.
 */
@RestController
@RequestMapping("/api")
class AgentBusController {

    private final AgentBusService agentBusService;

    AgentBusController(AgentBusService agentBusService) {
        this.agentBusService = agentBusService;
    }

    /** POST /api/agent-messages — record one A2A message (upsert thread + insert + trim). */
    @PostMapping("/agent-messages")
    OkResponse record(@Valid @RequestBody RecordAgentMessageRequest request) {
        agentBusService.record(UserContext.currentUserId(), request);
        return new OkResponse(true);
    }

    /** GET /api/agent-threads/{contextId} — thread + messages (ASC), 404 when unknown. */
    @GetMapping("/agent-threads/{contextId}")
    AgentConversation thread(@PathVariable String contextId) {
        return agentBusService.getConversation(contextId)
                .orElseThrow(() -> new NotFoundException("会话不存在"));
    }

    /** GET /api/agent-threads/{contextId}/messages?limit= — newest {@code limit}, re-ordered ASC. */
    @GetMapping("/agent-threads/{contextId}/messages")
    List<AgentMessage> messages(@PathVariable String contextId,
            @RequestParam(required = false) Integer limit) {
        return agentBusService.getRecentMessages(contextId, limit);
    }

    /**
     * GET /api/agent-threads — all recent conversations, or (with {@code ?participant=}) only
     * those a given agent takes part in.
     */
    @GetMapping("/agent-threads")
    List<AgentConversation> threads(@RequestParam(required = false) String participant) {
        return participant != null
                ? agentBusService.getAgentConversations(participant)
                : agentBusService.getAllConversations();
    }
}
