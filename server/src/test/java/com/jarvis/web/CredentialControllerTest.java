package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.CreateCredentialRequest;
import com.jarvis.domain.Credential;
import com.jarvis.domain.UpdateCredentialRequest;
import com.jarvis.service.CredentialService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(CredentialController.class)
class CredentialControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private CredentialService credentialService;

    private static Credential sample() {
        return new Credential("c1", "local", "Prod", "standard", "https://api", "sonnet", true,
                "2026-07-14T00:00:00Z", "2026-07-14T00:00:00Z");
    }

    @Test
    void listNeverExposesApiKey() throws Exception {
        when(credentialService.list("local")).thenReturn(List.of(sample()));

        mockMvc.perform(get("/api/credentials"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("c1"))
                .andExpect(jsonPath("$[0].isDefault").value(true))
                .andExpect(jsonPath("$[0].apiKey").doesNotExist())
                .andExpect(jsonPath("$[0].apiKeyEnc").doesNotExist());
    }

    @Test
    void createReturnsRedactedCredential() throws Exception {
        when(credentialService.add(eq("local"), any(CreateCredentialRequest.class)))
                .thenReturn(sample());

        mockMvc.perform(post("/api/credentials").contentType("application/json").content("""
                {"label":"Prod","tier":"standard","apiKey":"sk-x","baseUrl":"https://api","model":"sonnet"}
                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("c1"))
                .andExpect(jsonPath("$.apiKey").doesNotExist());
    }

    @Test
    void createRejectsMissingRequiredFields() throws Exception {
        mockMvc.perform(post("/api/credentials").contentType("application/json")
                        .content("{\"label\":\"Prod\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updateReturns404WhenMissing() throws Exception {
        when(credentialService.update(eq("local"), eq("nope"), any(UpdateCredentialRequest.class)))
                .thenReturn(Optional.empty());

        mockMvc.perform(put("/api/credentials/nope").contentType("application/json").content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("凭证不存在"));
    }

    @Test
    void deleteReturnsOkOr404() throws Exception {
        when(credentialService.delete("local", "c1")).thenReturn(true);
        mockMvc.perform(delete("/api/credentials/c1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));

        when(credentialService.delete("local", "gone")).thenReturn(false);
        mockMvc.perform(delete("/api/credentials/gone"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("凭证不存在"));
    }
}
