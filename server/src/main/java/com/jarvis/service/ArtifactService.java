package com.jarvis.service;

import com.jarvis.domain.ArtifactDetail;
import com.jarvis.domain.ArtifactListResponse;
import com.jarvis.domain.SaveArtifactRequest;
import com.jarvis.mapper.ArtifactMapper;
import com.jarvis.util.ArtifactStore;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Artifact read/write service. v0.3 file-store model:
 *
 * <ul>
 *   <li>{@code saveArtifact}: writes body to
 *       {@code ~/.jarvis/artifacts/{userId}/{id}.{ext}} and inserts a row with
 *       {@code uri=file://... , content=NULL} (the DB row is now tiny).</li>
 *   <li>{@code updateContent}: overwrites the same file (reuses existing artifactId so
 *       the URI stays stable) and bumps {@code version}. Legacy rows with only
 *       {@code content} are migrated in place — the write path is the same.</li>
 *   <li>{@code getDetail}: unchanged shape — the response mapper picks {@code content}
 *       (legacy) or {@code uri} (new) and drops the other via {@code @JsonInclude}.</li>
 * </ul>
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
     * In-place update with a version bump and fresh {@code updated_at} (ports tools.ts
     * update_artifact). Behaviour:
     * <ol>
     *   <li>lookup the existing row — must belong to {@code userId} (returns empty otherwise
     *       so the controller can 404).</li>
     *   <li>write the new body to the on-disk file (same path if URI already exists;
     *       legacy rows get a fresh file created here).</li>
     *   <li>UPDATE the row: set {@code uri}, clear {@code content}, {@code version+1}.</li>
     * </ol>
     * {@code title} is optional (null keeps the stored title). Returns the refreshed
     * artifact for the response body.
     */
    @Transactional
    public Optional<ArtifactDetail> updateContent(String userId, String id, String content,
            String title) {
        // Verify ownership before touching disk — avoids stray files for foreign ids.
        Optional<ArtifactDetail> existing = artifactMapper.findDetailByIdAndUser(id, userId);
        if (existing.isEmpty()) {
            return Optional.empty();
        }
        ArtifactDetail cur = existing.get();
        // Reuse the same artifactId → same file path → overwrites in place. Legacy rows
        // (uri=null, content=..) transparently migrate: we write a fresh file for them.
        String uri = ArtifactStore.write(userId, cur.id(), cur.type(), cur.language(), content);
        int updated = artifactMapper.updateUri(id, userId, uri, title,
                System.currentTimeMillis());
        if (updated == 0) {
            // Row vanished between the lookup and the UPDATE (concurrent delete). Treat
            // as not-found — no rollback of the file needed; a subsequent create would
            // reuse the path anyway.
            return Optional.empty();
        }
        log.debug("update_artifact userId={} id={} withTitle={} uri={}", userId, id,
                title != null, uri);
        return artifactMapper.findDetailByIdAndUser(id, userId);
    }

    /**
     * Store a new artifact (ports the internal TS saveArtifact). v0.3: generates the
     * artifactId, writes the body to disk, and inserts the row with
     * {@code content=NULL, uri=file://...}. Returns the new id.
     */
    @Transactional
    public String saveArtifact(String userId, SaveArtifactRequest req) {
        String id = UUID.randomUUID().toString();
        String uri = ArtifactStore.write(userId, id, req.type(), req.language(), req.content());
        // content=null: never store the body in the TEXT column for new rows.
        artifactMapper.insert(id, userId, req.type(), req.title(), null, uri,
                req.language(), System.currentTimeMillis(), req.taskId());
        log.debug("save_artifact userId={} id={} type={} uri={}", userId, id, req.type(), uri);
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
