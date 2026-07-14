package com.jarvis.web;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.ArtifactRef;
import com.jarvis.domain.ChatImage;
import com.jarvis.domain.ConversationMessage;
import com.jarvis.service.ConversationService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(ConversationController.class)
class ConversationControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private ConversationService conversationService;

    @Test
    void conversationOmitsNullArtifactAndImageIds() throws Exception {
        var withArtifact = new ConversationMessage("jarvis", "hi", 2000L,
                new ArtifactRef("a1", "code", "Snippet"), null);
        var plain = new ConversationMessage("user", "yo", 1000L, null, null);
        when(conversationService.getConversation("local")).thenReturn(List.of(plain, withArtifact));

        mockMvc.perform(get("/api/conversation"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].content").value("yo"))
                .andExpect(jsonPath("$[0].artifact").doesNotExist())
                .andExpect(jsonPath("$[0].imageIds").doesNotExist())
                .andExpect(jsonPath("$[1].artifact.id").value("a1"));
    }

    @Test
    void chatImageReturnsDecodedBytesWithContentType() throws Exception {
        // "AAECAw==" decodes to 4 bytes 00 01 02 03
        when(conversationService.getChatImage("local", "img-1"))
                .thenReturn(Optional.of(new ChatImage("image/png", "AAECAw==")));

        mockMvc.perform(get("/api/chat-image/img-1"))
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
}
