package com.jarvis.service;

import com.jarvis.domain.AgentRecipe;
import com.jarvis.domain.RecipeRow;
import com.jarvis.domain.SubtaskSummary;
import com.jarvis.mapper.RecipeMapper;
import com.jarvis.mapper.SubtaskMapper;
import com.jarvis.util.Json;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Agent recipe reads. Ports src/team/registry.ts listRecipes (JSON columns parsed to
 * typed fields) and the recipe -> executed subtasks lookup.
 */
@Service
public class RecipeService {

    private static final Logger log = LoggerFactory.getLogger(RecipeService.class);

    private final RecipeMapper recipeMapper;
    private final SubtaskMapper subtaskMapper;

    public RecipeService(RecipeMapper recipeMapper, SubtaskMapper subtaskMapper) {
        this.recipeMapper = recipeMapper;
        this.subtaskMapper = subtaskMapper;
    }

    @Transactional(readOnly = true)
    public List<AgentRecipe> listRecipes(String userId) {
        log.debug("list_recipes userId={}", userId);
        return recipeMapper.listByUser(userId).stream().map(RecipeService::toRecipe).toList();
    }

    @Transactional(readOnly = true)
    public List<SubtaskSummary> listRecipeSubtasks(String userId, String recipeId) {
        return subtaskMapper.listSummaryByAssignee(userId, recipeId);
    }

    private static AgentRecipe toRecipe(RecipeRow r) {
        return new AgentRecipe(
                r.id(), r.name(), r.description(), r.systemPrompt(),
                Json.stringList(r.tools()), Json.stringList(r.skills()), r.model(),
                Json.map(r.context()), r.persistent() == 1, r.usageCount(),
                r.createdBy(), r.createdAt(), r.lastUsedAt() != null ? r.lastUsedAt() : "");
    }
}
