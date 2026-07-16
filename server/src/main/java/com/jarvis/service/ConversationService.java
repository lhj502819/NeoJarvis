package com.jarvis.service;

import com.jarvis.domain.ArtifactRef;
import com.jarvis.domain.ChatImage;
import com.jarvis.domain.ConversationMessage;
import com.jarvis.domain.ConversationRow;
import com.jarvis.domain.SaveChatImagesRequest;
import com.jarvis.mapper.ChatImageMapper;
import com.jarvis.mapper.ConversationMapper;
import com.jarvis.util.ChatImageStore;
import com.jarvis.util.Json;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * User↔Jarvis conversation reads and chat-image retrieval (ports the TS chat route).
 * Uses the latest session for the user; assembles the optional artifact ref and parses
 * the image-ids JSON, omitting both when absent (mirrors the TS {@code undefined}).
 */
@Service
public class ConversationService {

    private static final Logger log = LoggerFactory.getLogger(ConversationService.class);

    private final ConversationMapper conversationMapper;
    private final ChatImageMapper chatImageMapper;

    public ConversationService(ConversationMapper conversationMapper, ChatImageMapper chatImageMapper) {
        this.conversationMapper = conversationMapper;
        this.chatImageMapper = chatImageMapper;
    }

    @Transactional(readOnly = true)
    public List<ConversationMessage> getConversation(String userId) {
        log.debug("get_conversation userId={}", userId);
        return conversationMapper.findLatestSessionId(userId)
                .map(conversationMapper::listMessages)
                .map(rows -> rows.stream().map(ConversationService::toMessage).toList())
                .orElseGet(List::of);
    }

    @Transactional(readOnly = true)
    public Optional<ChatImage> getChatImage(String userId, String id) {
        return chatImageMapper.findByIdAndUser(id, userId);
    }

    // ─── writes (port src/jarvis/conversation.ts) ───

    /**
     * Append one message to the user's latest session (ports TS addToBuffer). Reuses the
     * newest session or creates one, stores the message with a BIGINT epoch-millis
     * {@code timestamp}, then bumps the session's ISO-8601 updated_at. An absent/empty
     * {@code imageIds} stores NULL (mirrors TS {@code imageIds && length ? stringify : null}).
     *
     * <p>返回自增主键 {@code id},供工具调用 traces 按 message_id 关联使用。
     */
    @Transactional
    public long addToBuffer(String userId, String role, String content,
            String artifactId, List<String> imageIds) {
        String sessionId = getOrCreateSession(userId);
        String imageIdsJson = (imageIds != null && !imageIds.isEmpty()) ? Json.stringify(imageIds) : null;
        long messageId = conversationMapper.insertMessage(sessionId, userId, role, content,
                System.currentTimeMillis(), artifactId, imageIdsJson);
        conversationMapper.touchSession(sessionId, Instant.now().toString());
        log.debug("add_to_buffer userId={} role={} sessionId={} messageId={}", userId, role, sessionId, messageId);
        return messageId;
    }

    /**
     * Persist a user↔Jarvis exchange as an ordered pair of messages (user then jarvis).
     *
     * <p><b>Deviation from TS:</b> the TS {@code saveConversation} did NOT write to the DB —
     * it only pushed the pair to EverOS long-term memory; the DB persistence actually
     * happened via two separate {@code addToBuffer} calls (user in orchestrator.ts, jarvis
     * in brain.ts). This server has no EverOS, so the endpoint reproduces the DB pair via
     * two {@code addToBuffer} writes, which is the durable behaviour the task specifies.
     */
    @Transactional
    public void saveConversation(String userId, String userMessage, String jarvisResponse) {
        addToBuffer(userId, "user", userMessage, null, null);
        addToBuffer(userId, "jarvis", jarvisResponse, null, null);
        log.debug("save_conversation userId={}", userId);
    }

    /**
     * Store inbound chat images (ports TS saveChatImages). v0.3 file-store: each image is
     * written to {@code ~/.jarvis/chat-images/{userId}/{id}.{ext}} via
     * {@link ChatImageStore}, and the row carries {@code data=NULL, uri=file://...}.
     * Symmetric to {@code ArtifactService.saveArtifact}. Returns the generated ids in
     * input order (unchanged signature) to attach to a message.
     */
    @Transactional
    public List<String> saveChatImages(String userId, List<SaveChatImagesRequest.Image> images) {
        List<String> ids = new ArrayList<>(images.size());
        long now = System.currentTimeMillis();
        for (SaveChatImagesRequest.Image img : images) {
            String id = UUID.randomUUID().toString();
            // Write bytes to disk first — file:// URI goes to the DB, base64 payload is dropped.
            String uri = ChatImageStore.write(userId, id, img.mediaType(), img.data());
            chatImageMapper.insert(id, userId, img.mediaType(), null, uri, now);
            ids.add(id);
        }
        log.debug("save_chat_images userId={} count={}", userId, ids.size());
        return ids;
    }

    /** Reuse the newest session or create one (ports TS getOrCreateSession, ISO-8601 timestamps). */
    private String getOrCreateSession(String userId) {
        return conversationMapper.findLatestSessionId(userId).orElseGet(() -> {
            String id = UUID.randomUUID().toString();
            String now = Instant.now().toString();
            conversationMapper.insertSession(id, userId, now, now);
            return id;
        });
    }

    private static ConversationMessage toMessage(ConversationRow r) {
        ArtifactRef artifact = r.artifactId() != null
                ? new ArtifactRef(r.artifactId(), r.artifactType(), r.artifactTitle())
                : null;
        // Empty/blank -> null so the field is omitted (mirrors TS safeParseIds -> undefined).
        List<String> imageIds = Json.stringListOrNull(r.imageIds());
        if (imageIds != null && imageIds.isEmpty()) {
            imageIds = null;
        }
        return new ConversationMessage(r.role(), r.content(), r.timestamp(), artifact, imageIds);
    }
}
