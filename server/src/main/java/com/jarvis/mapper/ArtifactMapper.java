package com.jarvis.mapper;

import com.jarvis.domain.ArtifactSummary;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * Read-only artifact lookup used to populate {@code TaskDetail.artifacts} (mirrors the
 * inline query in TS getTaskDetail). Artifact CRUD endpoints belong to the A3 batch.
 */
@Mapper
public interface ArtifactMapper {

    @Select("SELECT id, type, title, language, version, created_at AS createdAt "
            + "FROM jarvis_artifacts "
            + "WHERE task_id = #{taskId} AND user_id = #{userId} ORDER BY created_at ASC")
    List<ArtifactSummary> listSummaryByTask(@Param("taskId") String taskId,
            @Param("userId") String userId);
}
