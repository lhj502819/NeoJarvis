package com.jarvis.web;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

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
    void detailReturnsCodeZeroWithContentWhenPresent() throws Exception {
        when(artifactService.getDetail("local", "a1"))
                .thenReturn(Optional.of(new ArtifactDetail("a1", "code", "T", "the body", "ts")));

        mockMvc.perform(get("/api/artifact/a1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.content").value("the body"));
    }

    @Test
    void detailReturns404CodeMessageWhenMissing() throws Exception {
        when(artifactService.getDetail("local", "nope")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/artifact/nope"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value(404))
                .andExpect(jsonPath("$.message").value("制品不存在"));
    }
}
