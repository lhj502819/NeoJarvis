package com.jarvis.mapper;

import com.jarvis.domain.SessionRow;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface AgentSessionMapper {

    /** Agent sessions for a user, newest completed first (mirrors TS listAgentSessions). */
    // Explicit columns ordered to match the SessionRow constructor (auto-increment id and
    // user_id excluded), with AS aliases so mapping never depends on SELECT * order (CRITICAL-1).
    @Select("""
            SELECT session_id AS sessionId, recipe_id AS recipeId, domain, cwd, topics,
                   last_task_description AS lastTaskDescription, completed_at AS completedAt,
                   task_count AS taskCount
            FROM jarvis_claude_sessions WHERE user_id = #{userId}
            ORDER BY completed_at DESC
            """)
    List<SessionRow> listByUser(@Param("userId") String userId);
}
