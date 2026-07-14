package com.jarvis.mapper;

import com.jarvis.domain.TaskRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface TaskMapper {

    // Explicit columns ordered to match the TaskRow constructor (user_id excluded), with
    // AS aliases so mapping never depends on SELECT * ordering (CRITICAL-1).
    String COLS = "id, name, description, status, plan, result, error, "
            + "created_at AS createdAt, updated_at AS updatedAt";

    /** All tasks for a user, newest first (mirrors TS listTasks ORDER BY created_at DESC). */
    @Select("SELECT " + COLS + " FROM jarvis_tasks WHERE user_id = #{userId} "
            + "ORDER BY created_at DESC")
    List<TaskRow> listByUser(@Param("userId") String userId);

    /** Incremental variant: tasks updated after {@code since}, newest updated first. */
    @Select("SELECT " + COLS + " FROM jarvis_tasks WHERE user_id = #{userId} "
            + "AND updated_at > #{since} ORDER BY updated_at DESC")
    List<TaskRow> listByUserSince(@Param("userId") String userId, @Param("since") String since);

    @Select("SELECT " + COLS + " FROM jarvis_tasks WHERE id = #{id} AND user_id = #{userId}")
    Optional<TaskRow> findByIdAndUser(@Param("id") String id, @Param("userId") String userId);
}
