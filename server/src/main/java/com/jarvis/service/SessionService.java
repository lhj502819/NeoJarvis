package com.jarvis.service;

import com.jarvis.domain.AgentSession;
import com.jarvis.domain.RecordSessionRequest;
import com.jarvis.domain.SessionRow;
import com.jarvis.mapper.AgentSessionMapper;
import com.jarvis.util.Json;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Agent session registry writes and lookups. Ports src/a2a/history.ts: {@link #record} is the
 * upsert (insert with the extracted keyword topics, or merge topics + bump task_count on an
 * existing session) plus the 50-session cap; {@link #byDomain}/{@link #byRecipe} feed the TS
 * local matching (findMatchingSessionByDomain / findMatchingSession), which keeps its keyword
 * scoring client-side. Keyword extraction is duplicated here from the TS {@code extractKeywords}
 * so the topics column stays identical whether written by the old or the new path.
 */
@Service
public class SessionService {

    private static final Logger log = LoggerFactory.getLogger(SessionService.class);
    private static final int MAX_SESSIONS = 50;

    /** Mirrors the TS {@code extractKeywords} stop-word set (CN + EN + generic verbs). */
    private static final Set<String> STOP_WORDS = Set.of(
            "的", "了", "和", "与", "是", "在", "对", "将", "把", "被", "用", "让",
            "the", "a", "an", "and", "or", "of", "to", "in", "for", "is", "on", "that", "this",
            "帮我", "调研", "查", "搜索", "分析", "总结", "对比", "一下", "什么", "哪些", "怎么");

    private final AgentSessionMapper sessionMapper;

    public SessionService(AgentSessionMapper sessionMapper) {
        this.sessionMapper = sessionMapper;
    }

    @Transactional
    public void record(String userId, RecordSessionRequest req) {
        String description = req.description() != null ? req.description() : "";
        String domain = req.domain() != null ? req.domain() : "";
        String cwd = req.cwd() != null ? req.cwd() : "";
        List<String> keywords = extractKeywords(description);
        String completedAt = Instant.now().toString();

        Optional<SessionRow> existing = sessionMapper.findByUserAndSession(userId, req.sessionId());
        if (existing.isPresent()) {
            List<String> merged = union(Json.stringList(existing.get().topics()), keywords);
            sessionMapper.updateExisting(userId, req.sessionId(), Json.stringify(merged),
                    description, completedAt, domain, cwd);
            log.debug("record_session update userId={} sessionId={}", userId, req.sessionId());
        } else {
            sessionMapper.insertSession(userId, req.sessionId(), req.recipeId(), domain, cwd,
                    Json.stringify(keywords), description, completedAt);
            long count = sessionMapper.countByUser(userId);
            if (count > MAX_SESSIONS) {
                sessionMapper.deleteOldest(userId, (int) (count - MAX_SESSIONS));
            }
            log.debug("record_session insert userId={} sessionId={} total={}", userId,
                    req.sessionId(), count);
        }
    }

    @Transactional(readOnly = true)
    public List<AgentSession> byDomain(String userId, String domain) {
        log.debug("sessions_by_domain userId={} domain={}", userId, domain);
        return sessionMapper.listByUserAndDomain(userId, domain).stream()
                .map(AgentSession::from).toList();
    }

    @Transactional(readOnly = true)
    public List<AgentSession> byRecipe(String userId, String recipeId) {
        log.debug("sessions_by_recipe userId={} recipeId={}", userId, recipeId);
        return sessionMapper.listByUserAndRecipe(userId, recipeId).stream()
                .map(AgentSession::from).toList();
    }

    /**
     * Port of the TS {@code extractKeywords}: lowercase, replace CN/EN punctuation with spaces,
     * split on whitespace, drop tokens shorter than 2 chars or in the stop-word set, cap at 10.
     */
    static List<String> extractKeywords(String text) {
        if (text == null) {
            return List.of();
        }
        String cleaned = text.toLowerCase()
                .replaceAll("[，。！？、；：“”‘’（）\\[\\]{}]", " ");
        List<String> out = new ArrayList<>();
        for (String word : cleaned.trim().split("\\s+")) {
            if (word.length() >= 2 && !STOP_WORDS.contains(word)) {
                out.add(word);
            }
            if (out.size() >= 10) {
                break;
            }
        }
        return out;
    }

    /** Union preserving order, old entries first (mirrors TS {@code [...new Set([...old, ...new])]}). */
    private static List<String> union(List<String> older, List<String> newer) {
        Set<String> merged = new LinkedHashSet<>(older);
        merged.addAll(newer);
        return new ArrayList<>(merged);
    }
}
