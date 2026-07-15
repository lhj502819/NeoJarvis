package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.ArtifactDetail;
import com.jarvis.domain.ArtifactListResponse;
import com.jarvis.domain.ArtifactSummary;
import com.jarvis.service.ArtifactService;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(ArtifactController.class)
class ArtifactControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private ArtifactService artifactService;

    @Test
    void listReturnsTotalAndItemsWithoutContent() throws Exception {
        var item = new ArtifactSummary("a1", "code", "T", "ts", 1, 100L, 200L);
        when(artifactService.list(eq("local"), eq(null), eq(null), eq(null), eq(null)))
                .thenReturn(new ArtifactListResponse(1, List.of(item)));

        mockMvc.perform(get("/api/artifacts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].id").value("a1"))
                .andExpect(jsonPath("$.items[0].updatedAt").value(200))
                .andExpect(jsonPath("$.items[0].content").doesNotExist());
    }

    @Test
    void listForwardsQueryParams() throws Exception {
        when(artifactService.list(eq("local"), eq("doc"), eq("hello"), eq(10), eq(5)))
                .thenReturn(new ArtifactListResponse(0, List.of()));

        mockMvc.perform(get("/api/artifacts?type=doc&q=hello&limit=10&offset=5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
    }

    @Test
    void detailReturnsUriWithoutContentForNewRows() throws Exception {
        // v0.3 new-style row: uri is set, content is null in the DB.
        when(artifactService.getDetail("local", "a1"))
                .thenReturn(Optional.of(new ArtifactDetail("a1", "code", "T", null,
                        "file:///tmp/local/a1.ts", "ts", 3)));

        mockMvc.perform(get("/api/artifact/a1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.uri").value("file:///tmp/local/a1.ts"))
                .andExpect(jsonPath("$.content").doesNotExist())
                .andExpect(jsonPath("$.version").value(3));
    }

    @Test
    void detailReturnsContentForLegacyRowsWithoutUri() throws Exception {
        // Legacy row (pre-migration): uri is null; content still readable so the tool/UI
        // adapter can fall back to it without any DB backfill.
        when(artifactService.getDetail("local", "legacy"))
                .thenReturn(Optional.of(new ArtifactDetail("legacy", "markdown", "T",
                        "the old body", null, null, 1)));

        mockMvc.perform(get("/api/artifact/legacy"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.content").value("the old body"))
                .andExpect(jsonPath("$.uri").doesNotExist());
    }

    @Test
    void detailReturns404CodeMessageWhenMissing() throws Exception {
        when(artifactService.getDetail("local", "nope")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/artifact/nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(404))
                .andExpect(jsonPath("$.message").value("制品不存在"));
    }

    @Test
    void createReturnsGeneratedId() throws Exception {
        when(artifactService.saveArtifact(eq("local"), any())).thenReturn("art-new-1");

        mockMvc.perform(post("/api/artifacts").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"code\",\"title\":\"T\",\"content\":\"body\",\"language\":\"ts\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("art-new-1"));

        verify(artifactService).saveArtifact(eq("local"), any());
    }

    @Test
    void createRejectsBlankRequiredFields() throws Exception {
        mockMvc.perform(post("/api/artifacts").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"type\":\"\",\"title\":\"T\",\"content\":\"body\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void patchReturnsUpdatedArtifactWithUriAndBumpedVersion() throws Exception {
        // PATCH returns ArtifactDetail directly; new row shape carries uri, drops content.
        when(artifactService.updateContent("local", "a1", "new body", "New title"))
                .thenReturn(Optional.of(new ArtifactDetail("a1", "code", "New title", null,
                        "file:///tmp/local/a1.ts", "ts", 4)));

        mockMvc.perform(patch("/api/artifact/a1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"new body\",\"title\":\"New title\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.uri").value("file:///tmp/local/a1.ts"))
                .andExpect(jsonPath("$.content").doesNotExist())
                .andExpect(jsonPath("$.title").value("New title"))
                .andExpect(jsonPath("$.version").value(4));
    }

    @Test
    void patchKeepsTitleWhenOmitted() throws Exception {
        when(artifactService.updateContent("local", "a1", "just body", null))
                .thenReturn(Optional.of(new ArtifactDetail("a1", "code", "Kept", null,
                        "file:///tmp/local/a1.ts", "ts", 2)));

        mockMvc.perform(patch("/api/artifact/a1").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"just body\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Kept"))
                .andExpect(jsonPath("$.version").value(2));

        verify(artifactService).updateContent("local", "a1", "just body", null);
    }

    @Test
    void patchReturns404CodeMessageWhenMissing() throws Exception {
        when(artifactService.updateContent("local", "nope", "x", null)).thenReturn(Optional.empty());

        mockMvc.perform(patch("/api/artifact/nope").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"x\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(404))
                .andExpect(jsonPath("$.message").value("制品不存在"));
    }
}
