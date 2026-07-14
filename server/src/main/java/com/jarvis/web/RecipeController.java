package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.AgentRecipe;
import com.jarvis.domain.SubtaskSummary;
import com.jarvis.service.RecipeService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
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

    /** GET /api/recipe/{recipeId}/subtasks — subtasks executed by that recipe. */
    @GetMapping("/recipe/{recipeId}/subtasks")
    List<SubtaskSummary> recipeSubtasks(@PathVariable String recipeId) {
        return recipeService.listRecipeSubtasks(UserContext.currentUserId(), recipeId);
    }
}
