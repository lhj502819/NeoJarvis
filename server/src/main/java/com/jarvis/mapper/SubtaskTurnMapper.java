package com.jarvis.mapper;

import com.jarvis.domain.SubTaskTurn;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface SubtaskTurnMapper {

    /** Execution turns for a subtask, ordered by turn index (mirrors TS getSubtaskTurns). */
    // Explicit columns ordered to match the SubTaskTurn constructor, with AS aliases so
    // mapping never depends on SELECT * order (CRITICAL-1).
    @Select("""
            SELECT id, subtask_id AS subtaskId, turn_index AS turnIndex, text,
                   started_at AS startedAt, ended_at AS endedAt, created_at AS createdAt
            FROM jarvis_subtask_turns WHERE subtask_id = #{subtaskId}
            ORDER BY turn_index ASC
            """)
    List<SubTaskTurn> listBySubtask(@Param("subtaskId") String subtaskId);
}
