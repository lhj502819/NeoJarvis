package com.jarvis.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jarvis.domain.AgentRecipe;
import com.jarvis.domain.SubtaskSummary;
import com.jarvis.service.RecipeService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc(addFilters = false)
@WebMvcTest(RecipeController.class)
class RecipeControllerTest {

    @Autowired
    private MockMvc mockMvc;
    @MockBean
    private RecipeService recipeService;

    @Test
    void recipesReturnsTypedFields() throws Exception {
        when(recipeService.listRecipes("local")).thenReturn(List.of(new AgentRecipe(
                "r1", "Coder", "d", "sp", List.of("Bash"), List.of("tdd"), "sonnet",
                Map.of("scope", "repo"), true, 3, "jarvis", "2026-07-14", "")));

        mockMvc.perform(get("/api/recipes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("r1"))
                .andExpect(jsonPath("$[0].tools[0]").value("Bash"))
                .andExpect(jsonPath("$[0].persistent").value(true));
    }

    @Test
    void recipeSubtasksReturnsSummaryShape() throws Exception {
        when(recipeService.listRecipeSubtasks("local", "r1")).thenReturn(List.of(
                new SubtaskSummary("s1", "t1", "sub", "desc", "completed", "dev", 5, "2026-07-14")));

        mockMvc.perform(get("/api/recipe/r1/subtasks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("s1"))
                .andExpect(jsonPath("$[0].taskId").value("t1"))
                .andExpect(jsonPath("$[0].turnCount").value(5))
                .andExpect(jsonPath("$[0].domain").value("dev"));
    }

    @Test
    void recipesByIdsReturnsMatches() throws Exception {
        when(recipeService.listRecipesByIds(List.of("r1", "r2"))).thenReturn(List.of(new AgentRecipe(
                "r1", "Coder", "d", "sp", List.of("Bash"), List.of(), "sonnet",
                Map.of(), false, 0, "jarvis", "2026-07-14", "")));

        mockMvc.perform(get("/api/recipes/by-ids").param("ids", "r1,r2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("r1"));
    }

    @Test
    void createRecipeReturnsCreatedRecipe() throws Exception {
        when(recipeService.createRecipe(eq("local"), any())).thenReturn(new AgentRecipe(
                "ab12cd34", "Coder", "builds things", "sp", List.of("Bash"), List.of("tdd"),
                "sonnet", Map.of(), false, 0, "jarvis", "2026-07-15", ""));

        mockMvc.perform(post("/api/recipes").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Coder\",\"description\":\"builds things\","
                                + "\"systemPrompt\":\"sp\",\"tools\":[\"Bash\"]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value("ab12cd34"))
                .andExpect(jsonPath("$.model").value("sonnet"))
                .andExpect(jsonPath("$.persistent").value(false))
                .andExpect(jsonPath("$.usageCount").value(0));
    }

    @Test
    void createRecipeRejectsBlankName() throws Exception {
        mockMvc.perform(post("/api/recipes").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\",\"description\":\"d\",\"systemPrompt\":\"sp\","
                                + "\"tools\":[\"Bash\"]}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createRecipeRejectsMissingTools() throws Exception {
        mockMvc.perform(post("/api/recipes").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Coder\",\"description\":\"d\",\"systemPrompt\":\"sp\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void incrementUsageReturnsOk() throws Exception {
        mockMvc.perform(post("/api/recipe/r1/increment-usage"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
        verify(recipeService).incrementUsage("local", "r1");
    }

    @Test
    void promoteReturnsOk() throws Exception {
        mockMvc.perform(post("/api/recipe/r1/promote"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
        verify(recipeService).promoteRecipe("local", "r1");
    }

    @Test
    void removeReturnsOk() throws Exception {
        mockMvc.perform(delete("/api/recipe/r1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true));
        verify(recipeService).removeRecipe("local", "r1");
    }
}
