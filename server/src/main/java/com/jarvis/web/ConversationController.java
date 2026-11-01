package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.ChatImage;
import com.jarvis.domain.ChatImagesResponse;
import com.jarvis.domain.ConversationMessage;
import com.jarvis.domain.MessageIdResponse;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.SaveChatImagesRequest;
import com.jarvis.domain.SaveConversationRequest;
import com.jarvis.domain.SaveMessageRequest;
import com.jarvis.service.ConversationService;
import com.jarvis.service.MemoryResetService;
import com.jarvis.util.ChatImageStore;
import jakarta.validation.Valid;
import java.util.Base64;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
class ConversationController {

    private final ConversationService conversationService;
    private final MemoryResetService memoryResetService;

    ConversationController(ConversationService conversationService, MemoryResetService memoryResetService) {
        this.conversationService = conversationService;
        this.memoryResetService = memoryResetService;
    }

    /** GET /api/conversation — latest session's messages, oldest first ([] when none). */
    @GetMapping("/conversation")
    List<ConversationMessage> conversation() {
        return conversationService.getConversation(UserContext.currentUserId());
    }

    /**
     * POST /api/conversation/reset — 清空当前用户的记忆(对话 + 执行痕迹),保留团队小弟、
     * 制品库、凭证、配置。破坏性且不可逆;运行中任务的拦截在 TS agent 侧(3000)完成。
     */
    @PostMapping("/conversation/reset")
    OkResponse resetMemory() {
        memoryResetService.clearMemory(UserContext.currentUserId());
        return new OkResponse(true);
    }

    /**
     * GET /api/chat-image/{id} — image bytes with a long immutable cache (mirrors the TS
     * route). v0.3 file-store: prefers reading from disk via {@code uri} (new rows), and
     * falls back to base64-decoding {@code data} for legacy rows written before the
     * migration. Missing -> 404 {@code {error:"not found"}} via the global handler.
     */
    @GetMapping("/chat-image/{id}")
    ResponseEntity<byte[]> chatImage(@PathVariable String id) {
        ChatImage img = conversationService.getChatImage(UserContext.currentUserId(), id)
                .orElseThrow(() -> new NotFoundException("not found"));
        // Prefer uri (new): read raw bytes from disk. Fall back to legacy data (base64 TEXT).
        byte[] bytes = img.uri() != null && !img.uri().isBlank()
                ? ChatImageStore.read(img.uri())
                : Base64.getDecoder().decode(img.data());
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(img.mediaType()))
                .cacheControl(CacheControl.maxAge(java.time.Duration.ofSeconds(31536000)).cachePrivate())
                .body(bytes);
    }

    /** POST /api/conversation/messages — append one message to the latest session (ports addToBuffer). Returns the auto-generated id. */
    @PostMapping("/conversation/messages")
    MessageIdResponse addMessage(@Valid @RequestBody SaveMessageRequest request) {
        long id = conversationService.addToBuffer(UserContext.currentUserId(), request.role(),
                request.content(), request.artifactId(), request.imageIds());
        return new MessageIdResponse(id);
    }

    /** POST /api/conversation — persist a user↔Jarvis exchange as a message pair (ports saveConversation). */
    @PostMapping("/conversation")
    OkResponse saveConversation(@Valid @RequestBody SaveConversationRequest request) {
        conversationService.saveConversation(UserContext.currentUserId(),
                request.userMessage(), request.jarvisResponse());
        return new OkResponse(true);
    }

    /** POST /api/chat-images — store inbound images, return the generated ids (ports saveChatImages). */
    @PostMapping("/chat-images")
    ChatImagesResponse saveChatImages(@Valid @RequestBody SaveChatImagesRequest request) {
        List<String> ids = conversationService.saveChatImages(UserContext.currentUserId(),
                request.images());
        return new ChatImagesResponse(ids);
    }
}
