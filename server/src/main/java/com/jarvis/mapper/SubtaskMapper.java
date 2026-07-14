package com.jarvis.mapper;

import com.jarvis.domain.SubTaskRow;
import com.jarvis.domain.SubtaskSummary;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface SubtaskMapper {

    // Explicit columns ordered to match the SubTaskRow constructor. Critical here: the DB
    // column order (created_at/updated_at BEFORE started_at/turn_count/...) differs from the
    // record order, so SELECT * would mis-bind under column-order mapping (CRITICAL-1).
    @Select("""
            SELECT id, task_id AS taskId, name, description, assignee, domain, cwd, status,
                   progress, result, error, blocked_reason AS blockedReason,
                   depends_on AS dependsOn, started_at AS startedAt, turn_count AS turnCount,
                   retry_count AS retryCount, tokens_input AS tokensInput,
                   tokens_output AS tokensOutput, created_at AS createdAt, updated_at AS updatedAt
            FROM jarvis_subtasks WHERE task_id = #{taskId}
            """)
    List<SubTaskRow> listByTask(@Param("taskId") String taskId);

    /**
     * Subtask summaries executed by a given assignee, newest first, capped at 50 —
     * mirrors TS listSubtasksByAssignee for {@code /api/recipe/{id}/subtasks}.
     */
    @Select("SELECT id, task_id AS taskId, name, description, status, domain, "
            + "turn_count AS turnCount, created_at AS createdAt "
            + "FROM jarvis_subtasks WHERE user_id = #{userId} AND assignee = #{assignee} "
            + "ORDER BY created_at DESC LIMIT 50")
    List<SubtaskSummary> listSummaryByAssignee(@Param("userId") String userId,
            @Param("assignee") String assignee);

    // Full explicit column list matching the SubTaskRow constructor — same ordering as
    // listByTask (the DB column order differs from the record order, so SELECT * would
    // mis-bind under column-order mapping, CRITICAL-1).
    String ROW_COLS = """
            id, task_id AS taskId, name, description, assignee, domain, cwd, status,
            progress, result, error, blocked_reason AS blockedReason,
            depends_on AS dependsOn, started_at AS startedAt, turn_count AS turnCount,
            retry_count AS retryCount, tokens_input AS tokensInput,
            tokens_output AS tokensOutput, created_at AS createdAt, updated_at AS updatedAt
            """;

    /** A single subtask scoped to its owner (used by the update endpoint, which is keyed
     * only by subtask id in the URL — user scoping replaces the TS task_id scoping). */
    @Select("SELECT " + ROW_COLS + " FROM jarvis_subtasks WHERE id = #{id} AND user_id = #{userId}")
    Optional<SubTaskRow> findByIdAndUser(@Param("id") String id, @Param("userId") String userId);

    /** Insert a fresh subtask with status 'pending' (mirrors TS addSubTask INSERT). */
    @Insert("INSERT INTO jarvis_subtasks "
            + "(id, task_id, user_id, name, description, assignee, domain, cwd, status, "
            + "depends_on, created_at, updated_at) "
            + "VALUES (#{id}, #{taskId}, #{userId}, #{name}, #{description}, #{assignee}, "
            + "#{domain}, #{cwd}, 'pending', #{dependsOn}, #{createdAt}, #{updatedAt})")
    void insert(@Param("id") String id, @Param("taskId") String taskId,
            @Param("userId") String userId, @Param("name") String name,
            @Param("description") String description, @Param("assignee") String assignee,
            @Param("domain") String domain, @Param("cwd") String cwd,
            @Param("dependsOn") String dependsOn, @Param("createdAt") String createdAt,
            @Param("updatedAt") String updatedAt);

    /**
     * Full-column update of the mutable subtask fields (mirrors TS updateSubTask). The
     * service pre-merges non-null request fields over the stored row (read-overlay-write).
     */
    @Update("UPDATE jarvis_subtasks SET status = #{status}, progress = #{progress}, "
            + "result = #{result}, error = #{error}, blocked_reason = #{blockedReason}, "
            + "updated_at = #{updatedAt} WHERE id = #{id}")
    void updateFields(@Param("id") String id, @Param("status") String status,
            @Param("progress") String progress, @Param("result") String result,
            @Param("error") String error, @Param("blockedReason") String blockedReason,
            @Param("updatedAt") String updatedAt);

    /** Set started_at (mirrors TS setSubtaskStarted). */
    @Update("UPDATE jarvis_subtasks SET started_at = #{startedAt} WHERE id = #{id}")
    void setStarted(@Param("id") String id, @Param("startedAt") String startedAt);

    /** Write execution accounting once a run completes (mirrors TS finalizeSubtaskMeta). */
    @Update("UPDATE jarvis_subtasks SET turn_count = #{turnCount}, retry_count = #{retryCount}, "
            + "tokens_input = #{tokensInput}, tokens_output = #{tokensOutput} WHERE id = #{id}")
    void finalizeMeta(@Param("id") String id, @Param("turnCount") int turnCount,
            @Param("retryCount") int retryCount, @Param("tokensInput") int tokensInput,
            @Param("tokensOutput") int tokensOutput);

    /**
     * Cancel this user's in-flight subtasks on restart (mirrors TS cleanupStaleTasks:
     * subtasks in {@code running}/{@code pending} -> {@code cancelled}).
     */
    @Update("UPDATE jarvis_subtasks SET status = 'cancelled', updated_at = #{updatedAt} "
            + "WHERE user_id = #{userId} AND status IN ('running', 'pending')")
    int cancelStale(@Param("userId") String userId, @Param("updatedAt") String updatedAt);
}
