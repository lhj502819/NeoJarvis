package com.jarvis.mapper;

import com.jarvis.domain.SessionRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface AgentSessionMapper {

    /** Column projection shared by every SessionRow select (explicit AS aliases, CRITICAL-1). */
    String COLUMNS = "session_id AS sessionId, recipe_id AS recipeId, domain, cwd, topics, "
            + "last_task_description AS lastTaskDescription, completed_at AS completedAt, "
            + "task_count AS taskCount";

    /** Agent sessions for a user, newest completed first (mirrors TS listAgentSessions). */
    // Explicit columns ordered to match the SessionRow constructor (auto-increment id and
    // user_id excluded), with AS aliases so mapping never depends on SELECT * order (CRITICAL-1).
    @Select("SELECT " + COLUMNS + " FROM jarvis_claude_sessions WHERE user_id = #{userId} "
            + "ORDER BY completed_at DESC")
    List<SessionRow> listByUser(@Param("userId") String userId);

    /** Single session by natural key (user + session_id) — drives the record upsert branch. */
    @Select("SELECT " + COLUMNS + " FROM jarvis_claude_sessions "
            + "WHERE user_id = #{userId} AND session_id = #{sessionId}")
    Optional<SessionRow> findByUserAndSession(@Param("userId") String userId,
            @Param("sessionId") String sessionId);

    /** Sessions in a domain, newest first (backs GET /api/sessions/by-domain + TS local match). */
    @Select("SELECT " + COLUMNS + " FROM jarvis_claude_sessions "
            + "WHERE user_id = #{userId} AND domain = #{domain} ORDER BY completed_at DESC")
    List<SessionRow> listByUserAndDomain(@Param("userId") String userId,
            @Param("domain") String domain);

    /** Sessions for a recipe (backs GET /api/sessions/match — TS scores them locally). */
    @Select("SELECT " + COLUMNS + " FROM jarvis_claude_sessions "
            + "WHERE user_id = #{userId} AND recipe_id = #{recipeId} ORDER BY completed_at DESC")
    List<SessionRow> listByUserAndRecipe(@Param("userId") String userId,
            @Param("recipeId") String recipeId);

    /** Insert a fresh session with task_count = 1 (mirrors the TS recordAgentSession INSERT). */
    @Insert("INSERT INTO jarvis_claude_sessions "
            + "(user_id, session_id, recipe_id, domain, cwd, topics, last_task_description, "
            + "completed_at, task_count) "
            + "VALUES (#{userId}, #{sessionId}, #{recipeId}, #{domain}, #{cwd}, #{topics}, "
            + "#{description}, #{completedAt}, 1)")
    void insertSession(@Param("userId") String userId, @Param("sessionId") String sessionId,
            @Param("recipeId") String recipeId, @Param("domain") String domain,
            @Param("cwd") String cwd, @Param("topics") String topics,
            @Param("description") String description, @Param("completedAt") String completedAt);

    /**
     * Bump an existing session: merged topics, latest description/completed_at, task_count+1,
     * and fill blank domain/cwd from the incoming values (mirrors the TS UPDATE with
     * COALESCE(NULLIF(domain, ''), ?)).
     */
    @Update("UPDATE jarvis_claude_sessions SET topics = #{topics}, "
            + "last_task_description = #{description}, completed_at = #{completedAt}, "
            + "task_count = task_count + 1, domain = COALESCE(NULLIF(domain, ''), #{domain}), "
            + "cwd = COALESCE(NULLIF(cwd, ''), #{cwd}) "
            + "WHERE user_id = #{userId} AND session_id = #{sessionId}")
    void updateExisting(@Param("userId") String userId, @Param("sessionId") String sessionId,
            @Param("topics") String topics, @Param("description") String description,
            @Param("completedAt") String completedAt, @Param("domain") String domain,
            @Param("cwd") String cwd);

    /** Count a user's sessions — drives the 50-session cap after an insert. */
    @Select("SELECT COUNT(*) FROM jarvis_claude_sessions WHERE user_id = #{userId}")
    long countByUser(@Param("userId") String userId);

    /**
     * Delete the {@code n} oldest sessions for a user (by completed_at ASC). The derived-table
     * wrapper is required because MySQL forbids referencing the target table directly in a
     * DELETE subquery (mirrors the TS DELETE ... WHERE id IN (SELECT ... LIMIT)).
     */
    @Delete("DELETE FROM jarvis_claude_sessions WHERE id IN ("
            + "SELECT id FROM (SELECT id FROM jarvis_claude_sessions WHERE user_id = #{userId} "
            + "ORDER BY completed_at ASC LIMIT #{n}) AS oldest)")
    void deleteOldest(@Param("userId") String userId, @Param("n") int n);
}
