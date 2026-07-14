package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.ChatImage;
import com.jarvis.domain.ConversationMessage;
import com.jarvis.service.ConversationService;
import java.util.Base64;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
class ConversationController {

    private final ConversationService conversationService;

    ConversationController(ConversationService conversationService) {
        this.conversationService = conversationService;
    }

    /** GET /api/conversation — latest session's messages, oldest first ([] when none). */
    @GetMapping("/conversation")
    List<ConversationMessage> conversation() {
        return conversationService.getConversation(UserContext.currentUserId());
    }

    /**
     * GET /api/chat-image/{id} — decoded image bytes with a long immutable cache (mirrors
     * the TS route). Missing -> 404 {@code {error:"not found"}} via the global handler.
     */
    @GetMapping("/chat-image/{id}")
    ResponseEntity<byte[]> chatImage(@PathVariable String id) {
        ChatImage img = conversationService.getChatImage(UserContext.currentUserId(), id)
                .orElseThrow(() -> new NotFoundException("not found"));
        byte[] bytes = Base64.getDecoder().decode(img.data());
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(img.mediaType()))
                .cacheControl(CacheControl.maxAge(java.time.Duration.ofSeconds(31536000)).cachePrivate())
                .body(bytes);
    }
}
