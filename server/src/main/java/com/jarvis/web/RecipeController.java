package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.AgentRecipe;
import com.jarvis.domain.CreateRecipeRequest;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.SubtaskSummary;
import com.jarvis.service.RecipeService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
class RecipeController {

    private final RecipeService recipeService;

    RecipeController(RecipeService recipeService) {
        this.recipeService = recipeService;
    }

    /** GET /api/recipes — user's agent recipes. */
    @GetMapping("/recipes")
    List<AgentRecipe> recipes() {
        return recipeService.listRecipes(UserContext.currentUserId());
    }

    /** GET /api/recipes/by-ids?ids=a,b,c — bulk lookup by id (NOT user-scoped, mirrors TS). */
    @GetMapping("/recipes/by-ids")
    List<AgentRecipe> recipesByIds(@RequestParam(required = false) List<String> ids) {
        return recipeService.listRecipesByIds(ids);
    }

    /** GET /api/recipe/{recipeId}/subtasks — subtasks executed by that recipe. */
    @GetMapping("/recipe/{recipeId}/subtasks")
    List<SubtaskSummary> recipeSubtasks(@PathVariable String recipeId) {
        return recipeService.listRecipeSubtasks(UserContext.currentUserId(), recipeId);
    }

    /** POST /api/recipes — create a recipe, return the full AgentRecipe (mirrors TS createRecipe). */
    @PostMapping("/recipes")
    AgentRecipe createRecipe(@Valid @RequestBody CreateRecipeRequest request) {
        return recipeService.createRecipe(UserContext.currentUserId(), request);
    }

    /** POST /api/recipe/{recipeId}/increment-usage — usage_count+1, last_used_at=now. */
    @PostMapping("/recipe/{recipeId}/increment-usage")
    OkResponse incrementUsage(@PathVariable String recipeId) {
        recipeService.incrementUsage(UserContext.currentUserId(), recipeId);
        return new OkResponse(true);
    }

    /** POST /api/recipe/{recipeId}/promote — set persistent = true. */
    @PostMapping("/recipe/{recipeId}/promote")
    OkResponse promote(@PathVariable String recipeId) {
        recipeService.promoteRecipe(UserContext.currentUserId(), recipeId);
        return new OkResponse(true);
    }

    /** DELETE /api/recipe/{recipeId} — remove a recipe. */
    @DeleteMapping("/recipe/{recipeId}")
    OkResponse remove(@PathVariable String recipeId) {
        recipeService.removeRecipe(UserContext.currentUserId(), recipeId);
        return new OkResponse(true);
    }
}
