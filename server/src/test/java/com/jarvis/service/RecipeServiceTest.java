package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.jarvis.domain.AgentRecipe;
import com.jarvis.domain.RecipeRow;
import com.jarvis.mapper.RecipeMapper;
import com.jarvis.mapper.SubtaskMapper;
import java.util.List;
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
}
