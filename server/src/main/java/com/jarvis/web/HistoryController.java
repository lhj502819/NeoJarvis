package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.AgentSession;
import com.jarvis.service.HistoryService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
class HistoryController {

    private final HistoryService historyService;

    HistoryController(HistoryService historyService) {
        this.historyService = historyService;
    }

    /** GET /api/history — historical agent sessions, newest first. */
    @GetMapping("/history")
    List<AgentSession> history() {
        return historyService.listSessions(UserContext.currentUserId());
    }
}
