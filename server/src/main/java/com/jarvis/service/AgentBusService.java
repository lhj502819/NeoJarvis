package com.jarvis.service;

import com.jarvis.domain.AgentConversation;
import com.jarvis.domain.AgentMessage;
import com.jarvis.domain.AgentMessageRow;
import com.jarvis.domain.AgentThreadRow;
import com.jarvis.domain.RecordAgentMessageRequest;
import com.jarvis.mapper.AgentBusMapper;
import com.jarvis.util.Json;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Jarvis↔Agent message-bus persistence, ported from the DB side of the TS {@code MessageBus}.
 * The in-memory agent registry / inbox / drain machinery stays in the TS process (it wraps
 * live handlers); only the durable reads and {@code recordMessage} move here.
 *
 * <p>{@link #record} reproduces {@code recordMessage}: upsert the thread (insert with the
 * initial participants, or union new participants + bump updated_at on an existing one), insert
 * the message, then trim the oldest threads past {@link #MAX_CONVERSATIONS}. The thread's
 * {@code user_id} is the acting user (X-Internal-User), matching the old TS
 * {@code this.ownerUserId || 'system'} — the reads never scope by it.
 */
@Service
public class AgentBusService {

    private static final Logger log = LoggerFactory.getLogger(AgentBusService.class);
    private static final int MAX_CONVERSATIONS = 100;
    private static final int DEFAULT_RECENT_LIMIT = 20;
    private static final String BROADCAST = "*";

    private final AgentBusMapper busMapper;

    public AgentBusService(AgentBusMapper busMapper) {
        this.busMapper = busMapper;
    }

    /** Upsert thread + insert message + trim, atomically (ports TS recordMessage). */
    @Transactional
    public void record(String userId, RecordAgentMessageRequest msg) {
        Optional<AgentThreadRow> existing = busMapper.findThread(msg.contextId());
        if (existing.isEmpty()) {
            List<String> participants = new ArrayList<>();
            participants.add(msg.from());
            if (!BROADCAST.equals(msg.to())) {
                participants.add(msg.to());
            }
            busMapper.insertThread(msg.contextId(), userId, Json.stringify(participants),
                    msg.timestamp(), msg.timestamp());
        } else {
            List<String> participants = new ArrayList<>(Json.stringList(existing.get().participants()));
            boolean changed = false;
            if (!participants.contains(msg.from())) {
                participants.add(msg.from());
                changed = true;
            }
            if (!BROADCAST.equals(msg.to()) && !participants.contains(msg.to())) {
                participants.add(msg.to());
                changed = true;
            }
            if (changed) {
                busMapper.updateThreadParticipants(msg.contextId(), Json.stringify(participants),
                        msg.timestamp());
            } else {
                busMapper.touchThread(msg.contextId(), msg.timestamp());
            }
        }

        busMapper.insertMessage(msg.id(), msg.contextId(), msg.from(), msg.to(), msg.role(),
                Json.write(msg.parts()), msg.timestamp(), Json.write(msg.metadata()));

        long count = busMapper.countThreads();
        if (count > MAX_CONVERSATIONS) {
            busMapper.deleteOldest((int) (count - MAX_CONVERSATIONS));
        }
        log.debug("record_agent_message ctx={} from={} to={}", msg.contextId(), msg.from(), msg.to());
    }

    /** Thread + its messages ascending, or empty when the thread is unknown (ports getConversation). */
    @Transactional(readOnly = true)
    public Optional<AgentConversation> getConversation(String contextId) {
        return busMapper.findThread(contextId).map(thread -> new AgentConversation(
                thread.id(),
                Json.stringList(thread.participants()),
                busMapper.listMessagesAsc(contextId).stream().map(AgentBusService::toMessage).toList(),
                thread.createdAt(),
                thread.updatedAt()));
    }

    /** Newest {@code limit} messages re-ordered ascending (ports getRecentMessages' rows.reverse()). */
    @Transactional(readOnly = true)
    public List<AgentMessage> getRecentMessages(String contextId, Integer limit) {
        int effective = (limit == null || limit <= 0) ? DEFAULT_RECENT_LIMIT : limit;
        List<AgentMessageRow> rows = new ArrayList<>(busMapper.listRecentMessages(contextId, effective));
        Collections.reverse(rows);
        return rows.stream().map(AgentBusService::toMessage).toList();
    }

    /** All conversations an agent participates in (ports getAgentConversations, LIKE %"agentId"%). */
    @Transactional(readOnly = true)
    public List<AgentConversation> getAgentConversations(String agentId) {
        String pattern = "%\"" + agentId + "\"%";
        return busMapper.findThreadsByParticipant(pattern).stream()
                .map(thread -> getConversation(thread.id()).orElse(null))
                .filter(Objects::nonNull)
                .toList();
    }

    /** Recent threads (metadata only, empty messages) capped at MAX (ports getAllConversations). */
    @Transactional(readOnly = true)
    public List<AgentConversation> getAllConversations() {
        return busMapper.listThreads(MAX_CONVERSATIONS).stream()
                .map(thread -> new AgentConversation(
                        thread.id(),
                        Json.stringList(thread.participants()),
                        List.of(),
                        thread.createdAt(),
                        thread.updatedAt()))
                .toList();
    }

    private static AgentMessage toMessage(AgentMessageRow r) {
        return new AgentMessage(r.id(), r.sender(), r.receiver(), r.threadId(), r.role(),
                Json.objectList(r.parts()), r.timestamp(), Json.mapOrNull(r.metadata()));
    }
}
