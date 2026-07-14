package com.jarvis.web;

import com.jarvis.auth.UserContext;
import com.jarvis.domain.AddSubTaskRequest;
import com.jarvis.domain.CreateTaskRequest;
import com.jarvis.domain.FinalizeSubtaskMetaRequest;
import com.jarvis.domain.OkResponse;
import com.jarvis.domain.RecordTurnRequest;
import com.jarvis.domain.SetSubtaskStartedRequest;
import com.jarvis.domain.SubTask;
import com.jarvis.domain.SubTaskTurn;
import com.jarvis.domain.Task;
import com.jarvis.domain.TaskDetail;
import com.jarvis.domain.TasksResponse;
import com.jarvis.domain.UpdateSubTaskRequest;
import com.jarvis.domain.UpdateTaskRequest;
import com.jarvis.service.TaskService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
class TaskController {

    private final TaskService taskService;

    TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    /** GET /api/tasks — {@code { summary, tasks }} (mirrors TS dashboard /tasks). */
    @GetMapping("/tasks")
    TasksResponse tasks(@RequestParam(required = false) String since) {
        String userId = UserContext.currentUserId();
        // Load once (honouring since) and derive the summary from that same list, so summary
        // and tasks always describe the same set — no second full scan, no drift (CRITICAL-2).
        List<Task> tasks = taskService.listTasks(userId, since);
        return new TasksResponse(taskService.getTaskSummary(tasks), tasks);
    }

    /** GET /api/task/{taskId} — full detail, 404 {@code {error:"任务不存在"}} when missing. */
    @GetMapping("/task/{taskId}")
    TaskDetail taskDetail(@PathVariable String taskId) {
        return taskService.getTaskDetail(UserContext.currentUserId(), taskId)
                .orElseThrow(() -> new NotFoundException("任务不存在"));
    }

    /** POST /api/tasks — create a task, return the full Task (mirrors TS createTask). */
    @PostMapping("/tasks")
    Task createTask(@Valid @RequestBody CreateTaskRequest request) {
        return taskService.createTask(UserContext.currentUserId(), request);
    }

    /** PATCH /api/task/{taskId} — partial update, 404 when missing (mirrors TS updateTask). */
    @PatchMapping("/task/{taskId}")
    Task updateTask(@PathVariable String taskId, @RequestBody UpdateTaskRequest request) {
        return taskService.updateTask(UserContext.currentUserId(), taskId, request);
    }

    /** POST /api/task/{taskId}/subtasks — add a subtask (mirrors TS addSubTask). */
    @PostMapping("/task/{taskId}/subtasks")
    SubTask addSubTask(@PathVariable String taskId, @Valid @RequestBody AddSubTaskRequest request) {
        return taskService.addSubTask(UserContext.currentUserId(), taskId, request);
    }

    /** PATCH /api/subtask/{id} — partial subtask update (mirrors TS updateSubTask). */
    @PatchMapping("/subtask/{id}")
    SubTask updateSubTask(@PathVariable String id, @RequestBody UpdateSubTaskRequest request) {
        return taskService.updateSubTask(UserContext.currentUserId(), id, request);
    }

    /** PATCH /api/subtask/{id}/started — set started_at (mirrors TS setSubtaskStarted). */
    @PatchMapping("/subtask/{id}/started")
    OkResponse setSubtaskStarted(@PathVariable String id,
            @Valid @RequestBody SetSubtaskStartedRequest request) {
        taskService.setSubtaskStarted(id, request.startedAt());
        return new OkResponse(true);
    }

    /** GET /api/subtask/{id}/turns — ordered execution turns (mirrors TS getSubtaskTurns). */
    @GetMapping("/subtask/{id}/turns")
    List<SubTaskTurn> subtaskTurns(@PathVariable String id) {
        return taskService.getSubtaskTurns(id);
    }

    /** POST /api/subtask/{id}/turns — record one execution turn (mirrors TS recordTurn). */
    @PostMapping("/subtask/{id}/turns")
    OkResponse recordTurn(@PathVariable String id, @RequestBody RecordTurnRequest request) {
        taskService.recordTurn(id, request);
        return new OkResponse(true);
    }

    /** PATCH /api/subtask/{id}/meta — write run accounting (mirrors TS finalizeSubtaskMeta). */
    @PatchMapping("/subtask/{id}/meta")
    OkResponse finalizeSubtaskMeta(@PathVariable String id,
            @RequestBody FinalizeSubtaskMetaRequest request) {
        taskService.finalizeSubtaskMeta(id, request);
        return new OkResponse(true);
    }

    /** POST /api/tasks/cleanup-stale — cancel this user's in-flight work (mirrors TS cleanupStaleTasks). */
    @PostMapping("/tasks/cleanup-stale")
    OkResponse cleanupStale() {
        taskService.cleanupStaleTasks(UserContext.currentUserId());
        return new OkResponse(true);
    }
}
