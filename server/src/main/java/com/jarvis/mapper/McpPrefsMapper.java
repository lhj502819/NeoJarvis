package com.jarvis.mapper;

import java.util.List;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * MCP-preference blacklist (ports src/jarvis/mcp-prefs.ts). A row means the user disabled
 * that MCP. Structurally identical to {@link SkillPrefsMapper} — {@link #insertIgnore} uses
 * MySQL {@code INSERT IGNORE} so re-disabling an already-disabled MCP is idempotent
 * against the (user_id, mcp_name) composite primary key.
 */
@Mapper
public interface McpPrefsMapper {

    @Select("SELECT mcp_name FROM jarvis_mcp_prefs WHERE user_id = #{userId}")
    List<String> listDisabled(@Param("userId") String userId);

    @Insert("INSERT IGNORE INTO jarvis_mcp_prefs (user_id, mcp_name) "
            + "VALUES (#{userId}, #{name})")
    void insertIgnore(@Param("userId") String userId, @Param("name") String name);

    @Delete("DELETE FROM jarvis_mcp_prefs WHERE user_id = #{userId} AND mcp_name = #{name}")
    void delete(@Param("userId") String userId, @Param("name") String name);
}
