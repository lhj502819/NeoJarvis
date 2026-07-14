package com.jarvis.mapper;

import com.jarvis.domain.SubTaskRow;
import com.jarvis.domain.SubtaskSummary;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

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
}
