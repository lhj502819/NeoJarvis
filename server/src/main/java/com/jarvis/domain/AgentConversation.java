package com.jarvis.domain;

import java.util.List;

/**
 * A thread plus its messages in API shape — field-for-field identical to the TS
 * {@code ConversationLog} interface ({@code contextId/participants/messages/createdAt/
 * updatedAt}). The list endpoint ({@code GET /api/agent-threads}) returns these with an empty
 * {@code messages} list (mirrors the old TS {@code getAllConversations}).
 */
public record AgentConversation(
        String contextId,
        List<String> participants,
        List<AgentMessage> messages,
        String createdAt,
        String updatedAt) {
}
