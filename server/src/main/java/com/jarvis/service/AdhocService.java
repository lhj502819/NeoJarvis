package com.jarvis.service;

import com.jarvis.domain.AdhocAgent;
import com.jarvis.domain.AdhocAgentRow;
import com.jarvis.domain.UpsertAdhocRequest;
import com.jarvis.mapper.AdhocMapper;
import com.jarvis.util.Json;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Adhoc (temporary) agent aggregation. Ports src/a2a/adhoc.ts: an upsert keyed by
 * {@code (user_id, domain)} that either seeds a new aggregate or bumps an existing one's
 * task_count and merges its topics. Two TS rules are load-bearing and preserved in the
 * service (they cannot live in a single SQL upsert):
 *
 * <ul>
 *   <li>Promoted guard — once an agent is promoted to a persistent recipe we stop
 *       accumulating temp-worker stats, so an upsert on a promoted domain is a no-op.</li>
 *   <li>Topic merge — existing ∪ new, de-duplicated (insertion order), capped at 20.</li>
 * </ul>
 *
 * Only a real session id resumes; the {@code auto-} fallback ids are stored as NULL.
 */
@Service
public class AdhocService {

    private static final Logger log = LoggerFactory.getLogger(AdhocService.class);
    private static final int MAX_TOPICS = 20;

    private final AdhocMapper adhocMapper;

    public AdhocService(AdhocMapper adhocMapper) {
        this.adhocMapper = adhocMapper;
    }

    @Transactional(readOnly = true)
    public Optional<AdhocAgent> get(String userId, String domain) {
        return adhocMapper.findByUserAndDomain(userId, domain).map(AdhocService::toAgent);
    }

    @Transactional(readOnly = true)
    public List<AdhocAgent> list(String userId) {
        log.debug("list_adhoc userId={}", userId);
        return adhocMapper.listActiveByUser(userId).stream().map(AdhocService::toAgent).toList();
    }

    /**
     * Upsert an adhoc aggregate (mirrors TS upsertAdhocAgent). Returns the resulting agent
     * — the unchanged existing one when it is already promoted (no-op), otherwise the
     * freshly written row.
     */
    @Transactional
    public AdhocAgent upsert(String userId, UpsertAdhocRequest req) {
        Optional<AdhocAgentRow> existing = adhocMapper.findByUserAndDomain(userId, req.domain());
        List<String> incoming = req.topics() != null ? req.topics() : List.of();

        if (existing.isPresent() && existing.get().promoted() == 1) {
            log.debug("upsert_adhoc userId={} domain={} skipped=promoted", userId, req.domain());
            return toAgent(existing.get());
        }

        String now = Instant.now().toString();
        String sid = realSessionId(req.sessionId());
        List<String> topics = existing.isPresent()
                ? mergeTopics(Json.stringList(existing.get().topics()), incoming)
                : incoming;
        // Keep the original id on update; only the insert path needs a fresh one.
        String id = existing.map(AdhocAgentRow::id).orElseGet(() -> "adhoc-"
                + UUID.randomUUID().toString().replace("-", "").substring(0, 8));

        adhocMapper.upsert(id, userId, req.domain(), req.taskDescription(),
                existing.map(AdhocAgentRow::cwd).orElse(req.cwd()), Json.stringify(topics), sid, now);
        log.debug("upsert_adhoc userId={} domain={} inserted={}", userId, req.domain(),
                existing.isEmpty());

        return adhocMapper.findByUserAndDomain(userId, req.domain())
                .map(AdhocService::toAgent)
                .orElseThrow(() -> new IllegalStateException("adhoc upsert lost the row"));
    }

    /** Flag the domain as promoted so it stops accumulating (mirrors TS markAdhocPromoted). */
    @Transactional
    public void markPromoted(String userId, String domain) {
        adhocMapper.markPromoted(userId, domain);
        log.debug("mark_adhoc_promoted userId={} domain={}", userId, domain);
    }

    /** existing ∪ new, de-duplicated in insertion order, capped at {@value #MAX_TOPICS}. */
    private static List<String> mergeTopics(List<String> existing, List<String> incoming) {
        LinkedHashSet<String> merged = new LinkedHashSet<>(existing);
        merged.addAll(incoming);
        return merged.stream().limit(MAX_TOPICS).toList();
    }

    /** Only a real session id resumes; null or an {@code auto-} fallback stores as NULL. */
    private static String realSessionId(String sessionId) {
        if (sessionId == null || sessionId.startsWith("auto-")) {
            return null;
        }
        return sessionId;
    }

    private static AdhocAgent toAgent(AdhocAgentRow r) {
        return new AdhocAgent(r.id(), r.userId(), r.domain(), r.taskCount(),
                r.lastTaskDescription(),
                r.cwd() != null && !r.cwd().isEmpty() ? r.cwd() : null,
                Json.stringList(r.topics()),
                r.lastSessionId() != null && !r.lastSessionId().isEmpty() ? r.lastSessionId() : null,
                r.promoted() == 1, r.createdAt(), r.updatedAt());
    }
}
