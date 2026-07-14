package com.jarvis.mapper;

import com.jarvis.domain.RecipeRow;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface RecipeMapper {

    // Column list is explicit and ordered to match the RecipeRow constructor, with AS
    // aliases for every snake_case column, so mapping never relies on SELECT * column
    // order (CRITICAL-1). arg-name-based-constructor-auto-mapping stays as a safety net.
    String COLS = "id, name, description, system_prompt AS systemPrompt, tools, model, "
            + "context, persistent, usage_count AS usageCount, created_by AS createdBy, "
            + "created_at AS createdAt, last_used_at AS lastUsedAt, skills";

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
}
