package com.jarvis.domain;

import jakarta.validation.constraints.NotNull;

/**
 * Body for {@code POST /api/conversation} — persists a user↔Jarvis exchange as a pair of
 * messages. See {@code ConversationService.saveConversation} for the deviation note: the
 * TS {@code saveConversation} only pushed to EverOS long-term memory, so the DB pair is
 * reproduced here via two {@code addToBuffer} writes (the TS DB behaviour).
 */
public record SaveConversationRequest(
        @NotNull String userMessage,
        @NotNull String jarvisResponse) {
}
