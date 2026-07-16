package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.ArtifactRef;
import com.jarvis.domain.ChatImage;
import com.jarvis.domain.ConversationMessage;
import com.jarvis.service.ConversationService;
import com.jarvis.util.ChatImageStore;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(ConversationController.class)
class ConversationControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private ConversationService conversationService;

    @Test
    void conversationOmitsNullArtifactAndImageIds() throws Exception {
        var withArtifact = new ConversationMessage(2L, "jarvis", "hi", 2000L,
                new ArtifactRef("a1", "code", "Snippet"), null);
        var plain = new ConversationMessage(1L, "user", "yo", 1000L, null, null);
        when(conversationService.getConversation("local")).thenReturn(List.of(plain, withArtifact));

        mockMvc.perform(get("/api/conversation"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].content").value("yo"))
                .andExpect(jsonPath("$[0].artifact").doesNotExist())
                .andExpect(jsonPath("$[0].imageIds").doesNotExist())
                .andExpect(jsonPath("$[1].artifact.id").value("a1"));
    }

    /**
     * v0.3 new-row path: uri is set → controller reads bytes from disk via
     * {@link ChatImageStore}. Static read is stubbed so this stays a pure unit test.
     */
    @Test
    void chatImageReadsBytesFromUriWhenPresent() throws Exception {
        byte[] pngBytes = new byte[]{0x00, 0x01, 0x02, 0x03};
        when(conversationService.getChatImage("local", "img-1"))
                .thenReturn(Optional.of(new ChatImage("image/png", null,
                        "file:///tmp/local/img-1.png")));

        try (MockedStatic<ChatImageStore> store = mockStatic(ChatImageStore.class)) {
            store.when(() -> ChatImageStore.read("file:///tmp/local/img-1.png"))
                    .thenReturn(pngBytes);

            mockMvc.perform(get("/api/chat-image/img-1"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Content-Type", "image/png"));
        }
    }

    /**
     * v0.3 legacy-row backwards-compat: uri is null but data (base64) is populated. The
     * controller must base64-decode data and return the bytes — matching the pre-v0.3
     * behaviour so old images stay accessible.
     */
    @Test
    void chatImageFallsBackToBase64DataWhenUriMissing() throws Exception {
        // "AAECAw==" decodes to 4 bytes 00 01 02 03
        when(conversationService.getChatImage("local", "legacy-1"))
                .thenReturn(Optional.of(new ChatImage("image/png", "AAECAw==", null)));

        mockMvc.perform(get("/api/chat-image/legacy-1"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "image/png"));
    }

    @Test
    void chatImageReturns404WhenMissing() throws Exception {
        when(conversationService.getChatImage("local", "gone")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/chat-image/gone"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("not found"));
    }

    @Test
    void addMessagePersistsAndReturnsId() throws Exception {
        when(conversationService.addToBuffer(anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(42L);

        mockMvc.perform(post("/api/conversation/messages").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"user\",\"content\":\"hi\",\"imageIds\":[\"i1\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(42));

        verify(conversationService).addToBuffer("local", "user", "hi", null, List.of("i1"));
    }

    @Test
    void addMessageRejectsUnknownRole() throws Exception {
        mockMvc.perform(post("/api/conversation/messages").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"bot\",\"content\":\"hi\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void addMessageRejectsMissingContent() throws Exception {
        mockMvc.perform(post("/api/conversation/messages").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"role\":\"user\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void saveConversationPersistsPairAndReturnsOk() throws Exception {
        mockMvc.perform(post("/api/conversation").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"userMessage\":\"q\",\"jarvisResponse\":\"a\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));

        verify(conversationService).saveConversation("local", "q", "a");
    }

    @Test
    void saveChatImagesReturnsGeneratedIds() throws Exception {
        when(conversationService.saveChatImages(eq("local"), anyList()))
                .thenReturn(List.of("id-1", "id-2"));

        mockMvc.perform(post("/api/chat-images").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"images\":[{\"mediaType\":\"image/png\",\"data\":\"AAA=\"}]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ids[0]").value("id-1"))
                .andExpect(jsonPath("$.ids[1]").value("id-2"));
    }

    @Test
    void saveChatImagesRejectsEmptyList() throws Exception {
        mockMvc.perform(post("/api/chat-images").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"images\":[]}"))
                .andExpect(status().isBadRequest());
    }
}
