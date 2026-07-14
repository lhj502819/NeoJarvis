package com.jarvis.service;

import com.jarvis.domain.ArtifactRef;
import com.jarvis.domain.ChatImage;
import com.jarvis.domain.ConversationMessage;
import com.jarvis.domain.ConversationRow;
import com.jarvis.mapper.ChatImageMapper;
import com.jarvis.mapper.ConversationMapper;
import com.jarvis.util.Json;
import java.util.List;
import java.util.Optional;
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
