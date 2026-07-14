package com.jarvis.service;

import com.jarvis.domain.AgentSession;
import com.jarvis.domain.SessionRow;
import com.jarvis.mapper.AgentSessionMapper;
import com.jarvis.util.Json;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Historical agent sessions. Ports src/a2a/history.ts listAgentSessions: topics JSON
 * parsed to a list, null domain/cwd coalesced to empty string (mirrors TS rowToSession).
 */
@Service
public class HistoryService {

    private static final Logger log = LoggerFactory.getLogger(HistoryService.class);

    private final AgentSessionMapper sessionMapper;

    public HistoryService(AgentSessionMapper sessionMapper) {
        this.sessionMapper = sessionMapper;
    }

    @Transactional(readOnly = true)
    public List<AgentSession> listSessions(String userId) {
        log.debug("list_sessions userId={}", userId);
        return sessionMapper.listByUser(userId).stream().map(HistoryService::toSession).toList();
    }

    private static AgentSession toSession(SessionRow r) {
        return new AgentSession(
                r.sessionId(), r.recipeId(),
                r.domain() != null ? r.domain() : "",
                r.cwd() != null ? r.cwd() : "",
                Json.stringList(r.topics()), r.lastTaskDescription(),
                r.completedAt(), r.taskCount());
    }
}
