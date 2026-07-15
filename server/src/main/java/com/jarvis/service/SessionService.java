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
     * split on whitespace, keep ASCII tokens ≥2 chars; also emit CJK bigrams from each token
     * (中文没空格,靠 bigram 才能命中跨会话匹配)。stop-word set drops noise,cap at 10。
     */
    static List<String> extractKeywords(String text) {
        if (text == null) {
            return List.of();
        }
        String cleaned = text.toLowerCase()
                .replaceAll("[，。！？、；：“”‘’（）\\[\\]{}]", " ");
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String token : cleaned.trim().split("\\s+")) {
            if (token.isEmpty()) continue;
            // ASCII token(英文/数字组合)按整体入
            if (token.length() >= 2 && !STOP_WORDS.contains(token) && isMostlyAscii(token)) {
                out.add(token);
            }
            // 从 token 里抽 CJK bigram(连续两个中文字符)
            for (String bigram : cjkBigrams(token)) {
                if (!STOP_WORDS.contains(bigram)) {
                    out.add(bigram);
                }
                if (out.size() >= 10) break;
            }
            if (out.size() >= 10) break;
        }
        return new ArrayList<>(out).subList(0, Math.min(out.size(), 10));
    }

    private static boolean isMostlyAscii(String s) {
        int ascii = 0;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) < 0x80) ascii++;
        }
        return ascii * 2 >= s.length();  // 半数以上 ASCII 视为英文/数字
    }

    private static List<String> cjkBigrams(String s) {
        List<String> out = new ArrayList<>();
        StringBuilder run = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (isCjk(c)) {
                run.append(c);
            } else {
                emitBigrams(run, out);
                run.setLength(0);
            }
        }
        emitBigrams(run, out);
        return out;
    }

    private static void emitBigrams(StringBuilder run, List<String> out) {
        for (int j = 0; j + 2 <= run.length(); j++) {
            out.add(run.substring(j, j + 2));
        }
    }

    private static boolean isCjk(char c) {
        return (c >= 0x4E00 && c <= 0x9FFF)   // CJK Unified Ideographs
            || (c >= 0x3400 && c <= 0x4DBF);  // Extension A
    }

    /** Union preserving order, old entries first (mirrors TS {@code [...new Set([...old, ...new])]}). */
    private static List<String> union(List<String> older, List<String> newer) {
        Set<String> merged = new LinkedHashSet<>(older);
        merged.addAll(newer);
        return new ArrayList<>(merged);
    }
}
