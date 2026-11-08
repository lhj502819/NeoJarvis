package com.jarvis.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jarvis.domain.AgentDocItem;
import com.jarvis.domain.AgentDocListResponse;
import com.jarvis.domain.AgentDocRow;
import com.jarvis.mapper.AgentDocMapper;
import java.util.List;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * CRUD over {@code jarvis_agent_docs} for the TS intelligence layer (ports the JSON sidecar
 * files it used to own). Thin on purpose: no domain rules here, the kinds and their shapes
 * live on the TS side — the server only guarantees per-user isolation, upsert semantics and
 * stable ordering. Kind/key validation keeps the table namespace tidy ({@code [a-z0-9-]}
 * kinds, non-blank keys within the column width).
 */
@Service
public class AgentDocService {

    private static final Logger log = LoggerFactory.getLogger(AgentDocService.class);
    private static final Pattern KIND = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");
    private static final int MAX_LIMIT = 500;

    private final AgentDocMapper agentDocMapper;
    private final ObjectMapper objectMapper;

    public AgentDocService(AgentDocMapper agentDocMapper, ObjectMapper objectMapper) {
        this.agentDocMapper = agentDocMapper;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public AgentDocListResponse list(String userId, String kind, String prefix, Integer limit) {
        requireKind(kind);
        int capped = Math.min(limit == null ? 200 : Math.max(limit, 1), MAX_LIMIT);
        List<AgentDocItem> items = agentDocMapper.list(userId, kind, prefix == null ? "" : prefix, capped).stream()
                .map(this::toItem)
                .toList();
        return new AgentDocListResponse(items);
    }

    @Transactional(readOnly = true)
    public JsonNode get(String userId, String kind, String docKey) {
        requireKind(kind);
        return agentDocMapper.find(userId, kind, docKey)
                .map(row -> parse(row.data(), kind, docKey))
                .orElseThrow(() -> new com.jarvis.web.NotFoundException("doc 不存在"));
    }

    @Transactional
    public void put(String userId, String kind, String docKey, JsonNode data) {
        requireKind(kind);
        if (docKey == null || docKey.isBlank() || docKey.length() > 191) {
            throw new com.jarvis.web.BadRequestException("doc_key 必填且不超过 191 字符");
        }
        if (data == null || data.isNull() || data.isMissingNode()) {
            throw new com.jarvis.web.BadRequestException("data 必填(JSON 主体)");
        }
        agentDocMapper.upsert(userId, kind, docKey, data.toString());
        log.debug("put_doc userId={} kind={} key={}", userId, kind, docKey);
    }

    @Transactional
    public boolean delete(String userId, String kind, String docKey) {
        requireKind(kind);
        return agentDocMapper.delete(userId, kind, docKey) > 0;
    }

    private AgentDocItem toItem(AgentDocRow row) {
        return new AgentDocItem(row.docKey(), parse(row.data(), "list", row.docKey()));
    }

    private JsonNode parse(String raw, String kind, String docKey) {
        try {
            return objectMapper.readTree(raw);
        } catch (Exception e) {
            // JSONB guarantees valid JSON; reaching here means storage drift — fail loudly.
            throw new IllegalStateException("jarvis_agent_docs 损坏: kind=" + kind + " key=" + docKey, e);
        }
    }

    private void requireKind(String kind) {
        if (kind == null || !KIND.matcher(kind).matches()) {
            throw new com.jarvis.web.BadRequestException("kind 必须匹配 [a-z0-9-]{1,64}");
        }
    }
}
