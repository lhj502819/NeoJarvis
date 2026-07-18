package com.jarvis.service;

import com.jarvis.domain.AgentRecipe;
import com.jarvis.domain.CreateRecipeRequest;
import com.jarvis.domain.RecipeRow;
import com.jarvis.domain.SubtaskSummary;
import com.jarvis.mapper.RecipeMapper;
import com.jarvis.mapper.SubtaskMapper;
import com.jarvis.util.Json;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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

    /**
     * Bulk lookup by id (mirrors TS registry.ts listRecipesByIds, which is NOT user-scoped).
     * Guards an empty/null id list so the mapper never emits an invalid {@code IN ()}.
     */
    @Transactional(readOnly = true)
    public List<AgentRecipe> listRecipesByIds(List<String> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return recipeMapper.findByIds(ids).stream().map(RecipeService::toRecipe).toList();
    }

    // ─── writes (port src/team/registry.ts) ───

    /**
     * Create a recipe (mirrors TS createRecipe): 8-char short id, TS defaults applied for the
     * optional fields ({@code skills=[]}, {@code model='sonnet'}, {@code context={}},
     * {@code persistent=false}, {@code createdBy='jarvis'}, {@code usageCount=0}). JSON fields
     * are serialised via {@link Json}; {@code last_used_at} is stored NULL (TS {@code '' || null})
     * while the returned recipe carries {@code lastUsedAt=""} to match the TS return shape.
     */
    @Transactional
    public AgentRecipe createRecipe(String userId, CreateRecipeRequest req) {
        String id = UUID.randomUUID().toString().substring(0, 8);
        String now = Instant.now().toString();
        List<String> tools = req.tools();
        List<String> skills = req.skills() != null ? req.skills() : List.of();
        String model = req.model() != null ? req.model() : "sonnet";
        Map<String, Object> context = req.context() != null ? req.context() : Map.of();
        boolean persistent = req.persistent() != null && req.persistent();
        String createdBy = req.createdBy() != null ? req.createdBy() : "jarvis";
        String avatar = req.avatar();  // 可空:Jarvis 生成时填 emoji,缺省由前端兜底

        recipeMapper.insert(id, userId, req.name(), req.description(), req.systemPrompt(),
                Json.stringify(tools), Json.stringify(skills), model, Json.stringify(context),
                persistent ? 1 : 0, 0, createdBy, now, null, avatar);
        log.debug("create_recipe userId={} id={}", userId, id);
        return new AgentRecipe(id, req.name(), req.description(), req.systemPrompt(),
                tools, skills, model, context, persistent, 0, createdBy, now, "", avatar);
    }

    /** usage_count + 1 and last_used_at = now (mirrors TS incrementUsage). No-op if missing. */
    @Transactional
    public void incrementUsage(String userId, String id) {
        recipeMapper.incrementUsage(id, userId, Instant.now().toString());
        log.debug("increment_recipe_usage userId={} id={}", userId, id);
    }

    /** Flip to persistent = true (mirrors TS promoteRecipe). No-op if missing. */
    @Transactional
    public void promoteRecipe(String userId, String id) {
        recipeMapper.promote(id, userId);
        log.debug("promote_recipe userId={} id={}", userId, id);
    }

    /** Delete a recipe scoped to the owner (mirrors TS removeRecipe). No-op if missing. */
    @Transactional
    public void removeRecipe(String userId, String id) {
        recipeMapper.remove(id, userId);
        log.debug("remove_recipe userId={} id={}", userId, id);
    }

    private static AgentRecipe toRecipe(RecipeRow r) {
        return new AgentRecipe(
                r.id(), r.name(), r.description(), r.systemPrompt(),
                Json.stringList(r.tools()), Json.stringList(r.skills()), r.model(),
                Json.map(r.context()), r.persistent() == 1, r.usageCount(),
                r.createdBy(), r.createdAt(), r.lastUsedAt() != null ? r.lastUsedAt() : "", r.avatar());
    }
}
