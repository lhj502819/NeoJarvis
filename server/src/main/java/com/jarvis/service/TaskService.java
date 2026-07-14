package com.jarvis.service;

import com.jarvis.domain.AgentRecipe;
import com.jarvis.domain.ArtifactSummary;
import com.jarvis.domain.AddSubTaskRequest;
import com.jarvis.domain.CreateTaskRequest;
import com.jarvis.domain.FinalizeSubtaskMetaRequest;
import com.jarvis.domain.RecipeRow;
import com.jarvis.domain.RecordTurnRequest;
import com.jarvis.domain.SubTask;
import com.jarvis.domain.SubTaskRow;
import com.jarvis.domain.SubTaskTurn;
import com.jarvis.domain.Task;
import com.jarvis.domain.TaskDetail;
import com.jarvis.domain.TaskRow;
import com.jarvis.domain.UpdateSubTaskRequest;
import com.jarvis.domain.UpdateTaskRequest;
import com.jarvis.mapper.ArtifactMapper;
import com.jarvis.mapper.RecipeMapper;
import com.jarvis.mapper.SubtaskMapper;
import com.jarvis.mapper.SubtaskTurnMapper;
import com.jarvis.mapper.TaskMapper;
import com.jarvis.util.Json;
import com.jarvis.web.NotFoundException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Task read model. Ports src/task/manager.ts: assembles API tasks (rows + subtasks +
 * permanent/adhoc identity), the active-task summary string, and the full task detail.
 */
@Service
public class TaskService {

    private static final Logger log = LoggerFactory.getLogger(TaskService.class);
    private static final Set<String> TERMINAL = Set.of("completed", "failed", "cancelled");

    private final TaskMapper taskMapper;
    private final SubtaskMapper subtaskMapper;
    private final RecipeMapper recipeMapper;
    private final SubtaskTurnMapper turnMapper;
    private final ArtifactMapper artifactMapper;

    public TaskService(TaskMapper taskMapper, SubtaskMapper subtaskMapper, RecipeMapper recipeMapper,
            SubtaskTurnMapper turnMapper, ArtifactMapper artifactMapper) {
        this.taskMapper = taskMapper;
        this.subtaskMapper = subtaskMapper;
        this.recipeMapper = recipeMapper;
        this.turnMapper = turnMapper;
        this.artifactMapper = artifactMapper;
    }

    @Transactional(readOnly = true)
    public List<Task> listTasks(String userId, String since) {
        log.debug("list_tasks userId={} since={}", userId, since);
        List<TaskRow> rows = (since == null || since.isBlank())
                ? taskMapper.listByUser(userId)
                : taskMapper.listByUserSince(userId, since);
        return rows.stream().map(this::assembleTask).toList();
    }

    /**
     * Active-task overview string (mirrors TS getTaskSummary). Operates on an already-loaded
     * task list rather than re-querying, so the summary and the returned tasks describe the
     * SAME set (e.g. both honour the {@code since} filter). Pure text assembly, no DB access.
     */
    public String getTaskSummary(List<Task> tasks) {
        if (tasks.isEmpty()) {
            return "当前没有任何任务。";
        }
        String body = tasks.stream()
                .filter(t -> !TERMINAL.contains(t.status()))
                .map(this::summariseTask)
                .collect(Collectors.joining("\n\n"));
        return body.isEmpty() ? "当前没有活跃任务。" : body;
    }

    @Transactional(readOnly = true)
    public Optional<TaskDetail> getTaskDetail(String userId, String taskId) {
        return taskMapper.findByIdAndUser(taskId, userId).map(row -> {
            Task task = assembleTask(row);

            Map<String, List<SubTaskTurn>> turnsBySubtask = new LinkedHashMap<>();
            Map<String, List<Object>> messagesBySubtask = new LinkedHashMap<>();
            for (SubTask st : task.subtasks()) {
                turnsBySubtask.put(st.id(), turnMapper.listBySubtask(st.id()));
                // A2 has no A2A bus yet — mirror TS empty-conversation branch.
                messagesBySubtask.put(st.id(), List.of());
            }

            List<ArtifactSummary> artifacts = artifactMapper.listSummaryByTask(taskId, userId);
            return new TaskDetail(task, turnsBySubtask, messagesBySubtask, null, artifacts);
        });
    }

    // ─── writes (port src/task/manager.ts) ───

    /** Create a task: 8-char short id, status 'created', created_at == updated_at == now. */
    @Transactional
    public Task createTask(String userId, CreateTaskRequest req) {
        String id = shortId();
        String now = now();
        taskMapper.insert(id, userId, req.name(), req.description(), "created", now, now);
        log.debug("create_task userId={} id={}", userId, id);
        return reloadTask(userId, id);
    }

    /** Partial update: only non-null request fields overwrite the stored row; updated_at bumped. */
    @Transactional
    public Task updateTask(String userId, String taskId, UpdateTaskRequest req) {
        TaskRow row = taskMapper.findByIdAndUser(taskId, userId)
                .orElseThrow(() -> new NotFoundException("任务不存在"));
        String now = now();
        taskMapper.updateFields(taskId, userId,
                req.status() != null ? req.status() : row.status(),
                req.plan() != null ? req.plan() : row.plan(),
                req.result() != null ? req.result() : row.result(),
                req.error() != null ? req.error() : row.error(),
                now);
        log.debug("update_task userId={} id={}", userId, taskId);
        return reloadTask(userId, taskId);
    }

    /** Add a subtask (status 'pending', 8-char short id), then bump the parent task's updated_at. */
    @Transactional
    public SubTask addSubTask(String userId, String taskId, AddSubTaskRequest req) {
        taskMapper.findByIdAndUser(taskId, userId)
                .orElseThrow(() -> new NotFoundException("任务不存在"));
        String id = shortId();
        String now = now();
        subtaskMapper.insert(id, taskId, userId, req.name(), req.description(), req.assignee(),
                req.domain(), req.cwd(), Json.stringify(req.dependsOn()), now, now);
        taskMapper.touch(taskId, now);
        log.debug("add_subtask userId={} taskId={} id={}", userId, taskId, id);
        return reloadSubTask(userId, id);
    }

    /** Partial subtask update; bumps the parent task's updated_at (mirrors TS updateSubTask). */
    @Transactional
    public SubTask updateSubTask(String userId, String subtaskId, UpdateSubTaskRequest req) {
        SubTaskRow row = subtaskMapper.findByIdAndUser(subtaskId, userId)
                .orElseThrow(() -> new NotFoundException("子任务不存在"));
        String now = now();
        subtaskMapper.updateFields(subtaskId,
                req.status() != null ? req.status() : row.status(),
                req.progress() != null ? req.progress() : row.progress(),
                req.result() != null ? req.result() : row.result(),
                req.error() != null ? req.error() : row.error(),
                req.blockedReason() != null ? req.blockedReason() : row.blockedReason(),
                now);
        taskMapper.touch(row.taskId(), now);
        log.debug("update_subtask userId={} id={}", userId, subtaskId);
        return reloadSubTask(userId, subtaskId);
    }

    /** Set a subtask's started_at (mirrors TS setSubtaskStarted, keyed by id only). */
    @Transactional
    public void setSubtaskStarted(String subtaskId, String startedAt) {
        subtaskMapper.setStarted(subtaskId, startedAt);
    }

    /** Persist one execution turn: 12-char short id, created_at now (mirrors TS recordTurn). */
    @Transactional
    public void recordTurn(String subtaskId, RecordTurnRequest req) {
        String id = UUID.randomUUID().toString().substring(0, 12);
        turnMapper.insert(id, subtaskId, req.turnIndex(), req.text(),
                req.startedAt(), req.endedAt(), now());
    }

    /** Write per-run accounting (mirrors TS finalizeSubtaskMeta, keyed by id only). */
    @Transactional
    public void finalizeSubtaskMeta(String subtaskId, FinalizeSubtaskMetaRequest req) {
        subtaskMapper.finalizeMeta(subtaskId, req.turnCount(), req.retryCount(),
                req.tokensInput(), req.tokensOutput());
    }

    /** Ordered execution turns for a subtask (mirrors TS getSubtaskTurns). */
    @Transactional(readOnly = true)
    public List<SubTaskTurn> getSubtaskTurns(String subtaskId) {
        return turnMapper.listBySubtask(subtaskId);
    }

    /**
     * On restart, cancel this user's in-flight work (mirrors TS cleanupStaleTasks): tasks in
     * executing/planning -> cancelled with the restart error; subtasks in running/pending ->
     * cancelled. (The task-brief's "running/executing -> failed" wording is superseded by the
     * authoritative TS logic per the必读, which uses 'cancelled'.)
     */
    @Transactional
    public void cleanupStaleTasks(String userId) {
        String now = now();
        taskMapper.cancelStale(userId, "进程重启，任务自动取消", now);
        subtaskMapper.cancelStale(userId, now);
        log.debug("cleanup_stale_tasks userId={}", userId);
    }

    // ─── assembly helpers ───

    /** Re-read a task by id+user and assemble the full API shape (with subtasks). */
    private Task reloadTask(String userId, String taskId) {
        return taskMapper.findByIdAndUser(taskId, userId)
                .map(this::assembleTask)
                .orElseThrow(() -> new NotFoundException("任务不存在"));
    }

    /** Re-read a subtask by id+user and tag its permanent/adhoc identity. */
    private SubTask reloadSubTask(String userId, String subtaskId) {
        SubTaskRow row = subtaskMapper.findByIdAndUser(subtaskId, userId)
                .orElseThrow(() -> new NotFoundException("子任务不存在"));
        return toSubTask(row, resolveRecipeNames(List.of(row)));
    }

    private static String shortId() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private static String now() {
        return Instant.now().toString();
    }

    private Task assembleTask(TaskRow row) {
        List<SubTask> subtasks = loadSubTasks(row.id());
        return new Task(row.id(), row.name(), row.description(), row.status(), row.plan(),
                subtasks, row.result(), row.error(), row.createdAt(), row.updatedAt());
    }

    /** Load subtasks and tag each with permanent/adhoc identity (mirrors TS loadSubTasks). */
    private List<SubTask> loadSubTasks(String taskId) {
        List<SubTaskRow> rows = subtaskMapper.listByTask(taskId);
        Map<String, String> recipeNames = resolveRecipeNames(rows);
        return rows.stream().map(r -> toSubTask(r, recipeNames)).toList();
    }

    private Map<String, String> resolveRecipeNames(List<SubTaskRow> rows) {
        List<String> assignees = rows.stream().map(SubTaskRow::assignee)
                .filter(a -> a != null && !a.isBlank()).distinct().toList();
        if (assignees.isEmpty()) {
            return Map.of();
        }
        return recipeMapper.findByIds(assignees).stream()
                .collect(Collectors.toMap(RecipeRow::id, RecipeRow::name, (a, b) -> a));
    }

    private SubTask toSubTask(SubTaskRow r, Map<String, String> recipeNames) {
        boolean permanent = recipeNames.containsKey(r.assignee());
        return new SubTask(
                r.id(), r.taskId(), r.name(), r.description(), r.assignee(),
                blankToNull(r.domain()), blankToNull(r.cwd()), r.status(),
                blankToNull(r.progress()), blankToNull(r.result()), blankToNull(r.error()),
                blankToNull(r.blockedReason()), Json.stringListOrNull(r.dependsOn()),
                blankToNull(r.startedAt()), r.turnCount(), r.retryCount(),
                r.tokensInput(), r.tokensOutput(), r.createdAt(), r.updatedAt(),
                permanent ? "permanent" : "adhoc",
                permanent ? recipeNames.get(r.assignee()) : r.assignee());
    }

    /** Reproduce the multi-line block TS getTaskSummary builds per active task. */
    private String summariseTask(Task t) {
        String subtaskLines = t.subtasks().stream().map(st -> {
            boolean canMessage = "running".equals(st.status()) || "input-required".equals(st.status());
            String idPart = canMessage ? " (subtaskId: " + st.id() + ")" : "";
            String progress = st.progress() != null ? " " + st.progress() : "";
            return "  - " + st.name() + " [" + st.status() + "]" + idPart + progress;
        }).collect(Collectors.joining("\n"));
        return "[" + t.status() + "] " + t.name() + " (id: " + t.id() + ")\n  "
                + t.description() + "\n" + subtaskLines;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isEmpty()) ? null : s;
    }
}
