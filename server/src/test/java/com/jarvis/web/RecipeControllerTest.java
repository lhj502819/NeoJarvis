package com.jarvis.web;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
}
