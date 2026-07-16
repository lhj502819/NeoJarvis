package com.jarvis.mapper;

import com.jarvis.domain.AdhocAgentRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * Adhoc (temporary) agent aggregate access (ports src/a2a/adhoc.ts). Rows are keyed by
 * the unique {@code (user_id, domain)}. {@link #upsert} is a PostgreSQL
 * {@code INSERT ... ON CONFLICT ... DO UPDATE}: a fresh domain inserts with
 * {@code task_count = 1}, an existing one bumps {@code task_count} and refreshes the
 * task/topics/session fields (the promoted-guard and topic-merge are applied in the
 * service before the write, matching the TS branch logic).
 */
@Mapper
public interface AdhocMapper {

    @Select("SELECT id, user_id AS userId, domain, task_count AS taskCount, "
            + "last_task_description AS lastTaskDescription, cwd, topics, "
            + "last_session_id AS lastSessionId, promoted, "
            + "created_at AS createdAt, updated_at AS updatedAt "
            + "FROM jarvis_adhoc_agents WHERE user_id = #{userId} AND domain = #{domain}")
    Optional<AdhocAgentRow> findByUserAndDomain(@Param("userId") String userId,
            @Param("domain") String domain);

    /** Active (non-promoted) agents, busiest first (mirrors TS listAdhocAgents). */
    @Select("SELECT id, user_id AS userId, domain, task_count AS taskCount, "
            + "last_task_description AS lastTaskDescription, cwd, topics, "
            + "last_session_id AS lastSessionId, promoted, "
            + "created_at AS createdAt, updated_at AS updatedAt "
            + "FROM jarvis_adhoc_agents WHERE user_id = #{userId} AND promoted = 0 "
            + "ORDER BY task_count DESC")
    List<AdhocAgentRow> listActiveByUser(@Param("userId") String userId);

    /**
     * Upsert by (user_id, domain). Insert path: task_count = 1, promoted = 0. Duplicate
     * path mirrors the TS UPDATE — task_count + 1, refreshed task/topics/updated_at, and
     * last_session_id kept unless a real (non-auto) session id is supplied. {@code cwd}
     * and {@code promoted} are intentionally NOT touched on update (TS keeps them).
     */
    @Insert("INSERT INTO jarvis_adhoc_agents "
            + "(id, user_id, domain, task_count, last_task_description, cwd, topics, "
            + "last_session_id, promoted, created_at, updated_at) "
            + "VALUES (#{id}, #{userId}, #{domain}, 1, #{lastTaskDescription}, #{cwd}, "
            + "#{topics}, #{lastSessionId}, 0, #{now}, #{now}) "
            + "ON CONFLICT (user_id, domain) DO UPDATE SET "
            + "task_count = jarvis_adhoc_agents.task_count + 1, "
            + "last_task_description = EXCLUDED.last_task_description, "
            + "topics = EXCLUDED.topics, "
            + "last_session_id = COALESCE(EXCLUDED.last_session_id, jarvis_adhoc_agents.last_session_id), "
            + "updated_at = EXCLUDED.updated_at")
    void upsert(@Param("id") String id, @Param("userId") String userId,
            @Param("domain") String domain,
            @Param("lastTaskDescription") String lastTaskDescription,
            @Param("cwd") String cwd, @Param("topics") String topics,
            @Param("lastSessionId") String lastSessionId, @Param("now") String now);

    @Update("UPDATE jarvis_adhoc_agents SET promoted = 1 "
            + "WHERE user_id = #{userId} AND domain = #{domain}")
    void markPromoted(@Param("userId") String userId, @Param("domain") String domain);
}
