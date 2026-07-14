package com.jarvis.service;

import com.jarvis.domain.ArtifactDetail;
import com.jarvis.domain.ArtifactListResponse;
import com.jarvis.domain.SaveArtifactRequest;
import com.jarvis.mapper.ArtifactMapper;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Artifact read model. Ports the TS dashboard/chat routes: a filtered, paged, redacted
 * list (summaries, no content) plus a single detail with content. Blank filter values
 * are normalized to null so an empty query param skips the clause (mirrors TS).
 */
@Service
public class ArtifactService {

    private static final Logger log = LoggerFactory.getLogger(ArtifactService.class);
    private static final int DEFAULT_LIMIT = 50;
    private static final int MAX_LIMIT = 100;

    private final ArtifactMapper artifactMapper;

    public ArtifactService(ArtifactMapper artifactMapper) {
        this.artifactMapper = artifactMapper;
    }

    @Transactional(readOnly = true)
    public ArtifactListResponse list(String userId, String type, String q, Integer limit, Integer offset) {
        String cleanType = blankToNull(type);
        String cleanQ = blankToNull(q);
        int cappedLimit = clampLimit(limit);
        int safeOffset = (offset == null || offset < 0) ? 0 : offset;
        log.debug("list_artifacts userId={} type={} q={} limit={} offset={}",
                userId, cleanType, cleanQ, cappedLimit, safeOffset);
        long total = artifactMapper.count(userId, cleanType, cleanQ);
        var items = artifactMapper.list(userId, cleanType, cleanQ, cappedLimit, safeOffset);
        return new ArtifactListResponse(total, items);
    }

    @Transactional(readOnly = true)
    public Optional<ArtifactDetail> getDetail(String userId, String id) {
        return artifactMapper.findDetailByIdAndUser(id, userId);
    }

    /**
     * Store a new artifact (ports the internal TS saveArtifact): random UUID id, BIGINT
     * epoch-millis created_at, version left to the DB default (1). Returns the new id.
     */
    @Transactional
    public String saveArtifact(String userId, SaveArtifactRequest req) {
        String id = UUID.randomUUID().toString();
        artifactMapper.insert(id, userId, req.type(), req.title(), req.content(),
                req.language(), System.currentTimeMillis(), req.taskId());
        log.debug("save_artifact userId={} id={} type={}", userId, id, req.type());
        return id;
    }

    /** min(limit || 50, 100) — mirrors the TS {@code Math.min(Number(limit) || 50, 100)}. */
    private static int clampLimit(Integer limit) {
        int effective = (limit == null || limit <= 0) ? DEFAULT_LIMIT : limit;
        return Math.min(effective, MAX_LIMIT);
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s;
    }
}
