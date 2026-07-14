package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.AgentRecipe;
import com.jarvis.domain.CreateRecipeRequest;
import com.jarvis.domain.RecipeRow;
import com.jarvis.mapper.RecipeMapper;
import com.jarvis.mapper.SubtaskMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class RecipeServiceTest {

    private RecipeMapper recipeMapper;
    private RecipeService service;

    @BeforeEach
    void setUp() {
        recipeMapper = Mockito.mock(RecipeMapper.class);
        service = new RecipeService(recipeMapper, Mockito.mock(SubtaskMapper.class));
    }

    @Test
    void parsesJsonColumnsAndPersistentFlag() {
        // Given: raw JSON columns and persistent=1
        when(recipeMapper.listByUser("local")).thenReturn(List.of(new RecipeRow(
                "r1", "Coder", "d", "sp", "[\"Bash\",\"Edit\"]", "sonnet",
                "{\"scope\":\"repo\"}", 1, 3, "jarvis", "2026-07-14", null, "[\"tdd\"]")));

        // When
        AgentRecipe r = service.listRecipes("local").get(0);

        // Then: typed lists/map, boolean flag, null lastUsedAt -> ""
        assertThat(r.tools()).containsExactly("Bash", "Edit");
        assertThat(r.skills()).containsExactly("tdd");
        assertThat(r.context()).containsEntry("scope", "repo");
        assertThat(r.persistent()).isTrue();
        assertThat(r.lastUsedAt()).isEmpty();
    }

    @Test
    void createRecipeAppliesTsDefaultsAndSerialisesJson() {
        // Given: only the required fields, all optionals null
        CreateRecipeRequest req = new CreateRecipeRequest(
                "Coder", "builds things", "sp", List.of("Bash", "Edit"),
                null, null, null, null, null);

        // When
        AgentRecipe r = service.createRecipe("local", req);

        // Then: returned record carries TS defaults
        assertThat(r.id()).hasSize(8);
        assertThat(r.model()).isEqualTo("sonnet");
        assertThat(r.skills()).isEmpty();
        assertThat(r.context()).isEmpty();
        assertThat(r.persistent()).isFalse();
        assertThat(r.usageCount()).isZero();
        assertThat(r.createdBy()).isEqualTo("jarvis");
        assertThat(r.lastUsedAt()).isEmpty();

        // And: mapper.insert got serialised JSON, persistent=0, usageCount=0, null last_used_at
        verify(recipeMapper).insert(eq(r.id()), eq("local"), eq("Coder"), eq("builds things"),
                eq("sp"), eq("[\"Bash\",\"Edit\"]"), eq("[]"), eq("sonnet"), eq("{}"),
                eq(0), eq(0), eq("jarvis"), eq(r.createdAt()), isNull());
    }

    @Test
    void createRecipeHonoursProvidedOptionalFields() {
        // Given
        CreateRecipeRequest req = new CreateRecipeRequest(
                "Coder", "d", "sp", List.of("Bash"), List.of("tdd"), "opus",
                Map.of("scope", "repo"), true, "alice");

        // When
        AgentRecipe r = service.createRecipe("local", req);

        // Then
        assertThat(r.model()).isEqualTo("opus");
        assertThat(r.skills()).containsExactly("tdd");
        assertThat(r.context()).containsEntry("scope", "repo");
        assertThat(r.persistent()).isTrue();
        assertThat(r.createdBy()).isEqualTo("alice");
        verify(recipeMapper).insert(eq(r.id()), eq("local"), eq("Coder"), eq("d"), eq("sp"),
                eq("[\"Bash\"]"), eq("[\"tdd\"]"), eq("opus"), eq("{\"scope\":\"repo\"}"),
                eq(1), eq(0), eq("alice"), eq(r.createdAt()), isNull());
    }

    @Test
    void listRecipesByIdsGuardsEmpty() {
        assertThat(service.listRecipesByIds(List.of())).isEmpty();
        assertThat(service.listRecipesByIds(null)).isEmpty();
        verify(recipeMapper, never()).findByIds(Mockito.anyList());
    }

    @Test
    void listRecipesByIdsMapsRows() {
        when(recipeMapper.findByIds(List.of("r1"))).thenReturn(List.of(new RecipeRow(
                "r1", "Coder", "d", "sp", "[\"Bash\"]", "sonnet", "{}", 0, 0,
                "jarvis", "2026-07-15", null, "[]")));

        AgentRecipe r = service.listRecipesByIds(List.of("r1")).get(0);
        assertThat(r.id()).isEqualTo("r1");
        assertThat(r.tools()).containsExactly("Bash");
    }

    @Test
    void incrementUsageDelegatesToMapper() {
        service.incrementUsage("local", "r1");
        verify(recipeMapper).incrementUsage(eq("r1"), eq("local"), Mockito.anyString());
    }

    @Test
    void promoteRecipeDelegatesToMapper() {
        service.promoteRecipe("local", "r1");
        verify(recipeMapper).promote("r1", "local");
    }

    @Test
    void removeRecipeDelegatesToMapper() {
        service.removeRecipe("local", "r1");
        verify(recipeMapper).remove("r1", "local");
    }
}
