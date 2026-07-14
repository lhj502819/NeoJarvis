package com.jarvis.mapper;

import com.jarvis.domain.TaskRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

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

    /** Insert a fresh task (mirrors TS createTask INSERT). */
    @Insert("INSERT INTO jarvis_tasks "
            + "(id, user_id, name, description, status, created_at, updated_at) "
            + "VALUES (#{id}, #{userId}, #{name}, #{description}, #{status}, "
            + "#{createdAt}, #{updatedAt})")
    void insert(@Param("id") String id, @Param("userId") String userId,
            @Param("name") String name, @Param("description") String description,
            @Param("status") String status, @Param("createdAt") String createdAt,
            @Param("updatedAt") String updatedAt);

    /**
     * Full-column update of the mutable task fields (mirrors TS updateTask). The service
     * pre-merges non-null request fields over the stored row so this write never clobbers a
     * field the caller omitted (read-overlay-write, same as StateService.patchState).
     */
    @Update("UPDATE jarvis_tasks SET status = #{status}, plan = #{plan}, result = #{result}, "
            + "error = #{error}, updated_at = #{updatedAt} WHERE id = #{id} AND user_id = #{userId}")
    void updateFields(@Param("id") String id, @Param("userId") String userId,
            @Param("status") String status, @Param("plan") String plan,
            @Param("result") String result, @Param("error") String error,
            @Param("updatedAt") String updatedAt);

    /** Bump only updated_at (mirrors TS bumping the parent task on subtask writes). */
    @Update("UPDATE jarvis_tasks SET updated_at = #{updatedAt} WHERE id = #{id}")
    void touch(@Param("id") String id, @Param("updatedAt") String updatedAt);

    /**
     * Cancel this user's in-flight tasks on restart (mirrors TS cleanupStaleTasks: tasks in
     * {@code executing}/{@code planning} -> {@code cancelled} with the restart error message).
     */
    @Update("UPDATE jarvis_tasks SET status = 'cancelled', error = #{error}, "
            + "updated_at = #{updatedAt} WHERE user_id = #{userId} "
            + "AND status IN ('executing', 'planning')")
    int cancelStale(@Param("userId") String userId, @Param("error") String error,
            @Param("updatedAt") String updatedAt);
}
