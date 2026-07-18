package com.jarvis.mapper;

import com.jarvis.domain.RecipeRow;
import java.util.List;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface RecipeMapper {

    // Column list is explicit and ordered to match the RecipeRow constructor, with AS
    // aliases for every snake_case column, so mapping never relies on SELECT * column
    // order (CRITICAL-1). arg-name-based-constructor-auto-mapping stays as a safety net.
    String COLS = "id, name, description, system_prompt AS systemPrompt, tools, model, "
            + "context, persistent, usage_count AS usageCount, created_by AS createdBy, "
            + "created_at AS createdAt, last_used_at AS lastUsedAt, skills, avatar";

    @Select("SELECT " + COLS + " FROM jarvis_recipes WHERE user_id = #{userId}")
    List<RecipeRow> listByUser(@Param("userId") String userId);

    /**
     * Bulk lookup by id (mirrors TS listRecipesByIds, which is NOT user-scoped) used
     * to resolve subtask assignee -> permanent recipe identity. Callers must guard
     * against an empty id collection.
     */
    @Select("<script>"
            + "SELECT " + COLS + " FROM jarvis_recipes WHERE id IN "
            + "<foreach item='id' collection='ids' open='(' separator=',' close=')'>#{id}</foreach>"
            + "</script>")
    List<RecipeRow> findByIds(@Param("ids") List<String> ids);

    /**
     * Insert a fresh recipe (mirrors TS registry.ts createRecipe INSERT). JSON columns
     * (tools/skills/context) are already serialised TEXT and {@code persistent} an INT
     * flag (0/1); {@code lastUsedAt} is passed as NULL for a brand-new recipe.
     */
    @Insert("INSERT INTO jarvis_recipes "
            + "(id, user_id, name, description, system_prompt, tools, skills, model, context, "
            + "persistent, usage_count, created_by, created_at, last_used_at, avatar) "
            + "VALUES (#{id}, #{userId}, #{name}, #{description}, #{systemPrompt}, #{tools}, "
            + "#{skills}, #{model}, #{context}, #{persistent}, #{usageCount}, #{createdBy}, "
            + "#{createdAt}, #{lastUsedAt}, #{avatar})")
    void insert(@Param("id") String id, @Param("userId") String userId,
            @Param("name") String name, @Param("description") String description,
            @Param("systemPrompt") String systemPrompt, @Param("tools") String tools,
            @Param("skills") String skills, @Param("model") String model,
            @Param("context") String context, @Param("persistent") int persistent,
            @Param("usageCount") int usageCount, @Param("createdBy") String createdBy,
            @Param("createdAt") String createdAt, @Param("lastUsedAt") String lastUsedAt,
            @Param("avatar") String avatar);

    /** Bump usage_count and stamp last_used_at (mirrors TS incrementUsage). */
    @Update("UPDATE jarvis_recipes SET usage_count = usage_count + 1, last_used_at = #{lastUsedAt} "
            + "WHERE id = #{id} AND user_id = #{userId}")
    void incrementUsage(@Param("id") String id, @Param("userId") String userId,
            @Param("lastUsedAt") String lastUsedAt);

    /** Flip the recipe to persistent (mirrors TS promoteRecipe: persistent = 1). */
    @Update("UPDATE jarvis_recipes SET persistent = 1 WHERE id = #{id} AND user_id = #{userId}")
    void promote(@Param("id") String id, @Param("userId") String userId);

    /** Delete a recipe scoped to the owning user (mirrors TS removeRecipe). */
    @Delete("DELETE FROM jarvis_recipes WHERE id = #{id} AND user_id = #{userId}")
    void remove(@Param("id") String id, @Param("userId") String userId);
}
