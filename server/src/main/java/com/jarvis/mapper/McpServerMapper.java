package com.jarvis.mapper;

import com.jarvis.domain.McpServerRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * User MCP server access (ports src/auth/mcp-servers.ts). All selects carry the encrypted
 * {@code env_enc} column — it is internal only; the service derives the redacted
 * {@code envKeys} and never lets ciphertext or plaintext env leave via {@link McpServerRow}
 * to a client. Rows are unique per {@code (user_id, name)}. {@code enabled} is INT 0/1.
 */
@Mapper
public interface McpServerMapper {

    @Select("SELECT id, user_id AS userId, name, transport, command, args_json AS argsJson, "
            + "url, env_enc AS envEnc, description, enabled, "
            + "created_at AS createdAt, updated_at AS updatedAt "
            + "FROM jarvis_user_mcp_servers WHERE user_id = #{userId} ORDER BY created_at ASC")
    List<McpServerRow> listByUser(@Param("userId") String userId);

    @Select("SELECT id, user_id AS userId, name, transport, command, args_json AS argsJson, "
            + "url, env_enc AS envEnc, description, enabled, "
            + "created_at AS createdAt, updated_at AS updatedAt "
            + "FROM jarvis_user_mcp_servers WHERE user_id = #{userId} AND name = #{name}")
    Optional<McpServerRow> findByUserAndName(@Param("userId") String userId,
            @Param("name") String name);

    /**
     * Enabled rows only, oldest first — carries the encrypted {@code env_enc}. Internal use
     * by resolve, which decrypts {@code env_enc} to the plaintext env map (mirrors TS
     * {@code resolveMcpServers}: {@code WHERE user_id = ? AND enabled = 1}).
     */
    @Select("SELECT id, user_id AS userId, name, transport, command, args_json AS argsJson, "
            + "url, env_enc AS envEnc, description, enabled, "
            + "created_at AS createdAt, updated_at AS updatedAt "
            + "FROM jarvis_user_mcp_servers WHERE user_id = #{userId} AND enabled = 1 "
            + "ORDER BY created_at ASC")
    List<McpServerRow> listEnabledByUser(@Param("userId") String userId);

    @Insert("INSERT INTO jarvis_user_mcp_servers "
            + "(id, user_id, name, transport, command, args_json, url, env_enc, description, "
            + "enabled, created_at, updated_at) "
            + "VALUES (#{id}, #{userId}, #{name}, #{transport}, #{command}, #{argsJson}, "
            + "#{url}, #{envEnc}, #{description}, 1, #{createdAt}, #{updatedAt})")
    void insert(@Param("id") String id, @Param("userId") String userId, @Param("name") String name,
            @Param("transport") String transport, @Param("command") String command,
            @Param("argsJson") String argsJson, @Param("url") String url,
            @Param("envEnc") String envEnc, @Param("description") String description,
            @Param("createdAt") String createdAt, @Param("updatedAt") String updatedAt);

    @Update("UPDATE jarvis_user_mcp_servers SET transport = #{transport}, command = #{command}, "
            + "args_json = #{argsJson}, url = #{url}, env_enc = #{envEnc}, "
            + "description = #{description}, enabled = #{enabled}, updated_at = #{updatedAt} "
            + "WHERE user_id = #{userId} AND name = #{name}")
    void update(@Param("userId") String userId, @Param("name") String name,
            @Param("transport") String transport, @Param("command") String command,
            @Param("argsJson") String argsJson, @Param("url") String url,
            @Param("envEnc") String envEnc, @Param("description") String description,
            @Param("enabled") int enabled, @Param("updatedAt") String updatedAt);

    @Delete("DELETE FROM jarvis_user_mcp_servers WHERE user_id = #{userId} AND name = #{name}")
    int delete(@Param("userId") String userId, @Param("name") String name);
}
