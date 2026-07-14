# Jarvis Server(Java)· 工作指南

v0.3 Java 服务端。**始终遵守**以下三份技能规范(全局 skills):

1. **java-coding-standards** (`~/.claude/skills/java-coding-standards/SKILL.md`)
   Java 21 编码规范:命名、不可变、Optional、异常、streams、日志

2. **springboot-patterns** (`~/.claude/plugins/marketplaces/everything-claude-code/skills/springboot-patterns/SKILL.md`)
   Spring Boot 分层、REST、DTO、异常处理、`@Transactional`、日志、observability

3. **springboot-tdd** (`~/.claude/skills/springboot-tdd/SKILL.md`)
   TDD:先写失败的测试 → 实现 → 重构。JUnit 5 + AssertJ + MockMvc + `@SpringBootTest`

## 项目分层(必守)

```
server/src/main/java/com/jarvis/
├── JarvisServerApplication.java     入口
├── config/                          @Configuration:datasource / security / mvc
├── web/                             @RestController:HTTP 路由,thin controllers
├── service/                         @Service:业务逻辑 + 事务边界
├── mapper/                          MyBatis @Mapper interfaces(注解 SQL,不写 xml)
├── domain/                          领域实体 / DTO(records 优先)
├── auth/                            认证过滤器 / UserContext
├── sse/                             EventBus + SseEmitter 相关
└── util/                            工具类,少用
```

**分层依赖方向(严禁反向)**:
```
web ─→ service ─→ mapper
       ↓
     domain(共享)
```

- Controller **不许**直接调 Mapper,必须通过 Service
- Service **不许**返回 Entity;返回 Domain record / DTO
- Mapper **只**做 CRUD SQL,不做业务逻辑
- **构造器注入**(no `@Autowired` 字段);字段 `final`

## 数据访问:MyBatis 注解方式(非 JPA)

不写 mapper.xml,注解直接写在 interface 上:

```java
@Mapper
public interface TaskMapper {
    @Select("SELECT * FROM jarvis_tasks WHERE id = #{id}")
    Optional<Task> findById(@Param("id") String id);

    @Select("SELECT * FROM jarvis_tasks WHERE user_id = #{userId} ORDER BY updated_at DESC")
    List<Task> listByUser(@Param("userId") String userId);

    @Insert("""
        INSERT INTO jarvis_tasks (id, user_id, name, description, status, created_at, updated_at)
        VALUES (#{id}, #{userId}, #{name}, #{description}, #{status}, #{createdAt}, #{updatedAt})
        """)
    void insert(Task task);
}
```

**约定**:
- 表字段 `snake_case`,Java 字段 `camelCase`,靠 `map-underscore-to-camel-case: true` 自动转换
- 参数用 `@Param("name")`,SQL 里用 `#{name}`
- 复杂查询/动态 SQL 才允许迁到 xml 或 `@SelectProvider`

## DTO 规范(records 优先)

```java
// 请求 DTO(Bean Validation)
public record CreateTaskRequest(
    @NotBlank @Size(max = 200) String name,
    @NotBlank @Size(max = 2000) String description
) {}

// 响应 DTO
public record TaskResponse(String id, String name, String status, String createdAt) {
    public static TaskResponse from(Task task) {
        return new TaskResponse(task.id(), task.name(), task.status(), task.createdAt());
    }
}
```

## Controller 骨架(遵守 springboot-patterns)

```java
@RestController
@RequestMapping("/api/tasks")
class TaskController {
    private final TaskService taskService;

    TaskController(TaskService taskService) {
        this.taskService = taskService;
    }

    @GetMapping
    ResponseEntity<List<TaskResponse>> list(@RequestParam(required = false) String since) {
        String userId = UserContext.currentUserId();
        List<Task> tasks = taskService.listByUser(userId, since);
        return ResponseEntity.ok(tasks.stream().map(TaskResponse::from).toList());
    }
}
```

## Service 骨架

```java
@Service
public class TaskService {
    private static final Logger log = LoggerFactory.getLogger(TaskService.class);
    private final TaskMapper taskMapper;

    public TaskService(TaskMapper taskMapper) {
        this.taskMapper = taskMapper;
    }

    @Transactional(readOnly = true)
    public List<Task> listByUser(String userId, String since) {
        log.debug("list_tasks userId={} since={}", userId, since);
        return since == null
            ? taskMapper.listByUser(userId)
            : taskMapper.listByUserSince(userId, since);
    }
}
```

## 异常处理(全局 handler)

```java
@RestControllerAdvice
class GlobalExceptionHandler {
    @ExceptionHandler(EntityNotFoundException.class)
    ResponseEntity<ApiError> notFound(EntityNotFoundException ex) {
        return ResponseEntity.status(404).body(ApiError.of(ex.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ApiError> validation(MethodArgumentNotValidException ex) {
        String msg = ex.getBindingResult().getFieldErrors().stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .collect(Collectors.joining(", "));
        return ResponseEntity.badRequest().body(ApiError.validation(msg));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiError> generic(Exception ex) {
        // log with stack
        return ResponseEntity.status(500).body(ApiError.of("Internal server error"));
    }
}
```

## TDD 工作流(遵守 springboot-tdd)

1. 先写测试(失败 red)
2. 最小代码通过(green)
3. 重构

**测试层级**:
- Mapper 单测 → `@MybatisTest` + H2 内存库
- Service 单测 → JUnit 5 + Mockito mock mapper
- Controller 单测 → `@WebMvcTest` + MockMvc
- 集成测试(端到端) → `@SpringBootTest` + `@ActiveProfiles("test")`

**约定**:
- AssertJ `assertThat(...)` 不用 JUnit assertEquals
- Given/When/Then 注释分节
- 测试类命名 `XxxTest`(单测)或 `XxxIntegrationTest`(集成)

## 命令备忘

```bash
cd server
mvn spring-boot:run              # 起服
mvn test                          # 全部测试
mvn test -Dtest=TaskServiceTest   # 单个类
mvn package -DskipTests           # 打包 jar
```

## 与 v0.2 TS 服务共存

- 端口 **8080**(TS 是 3000)
- 数据库 **MySQL**(TS 是 PostgreSQL)
- 老 TS 服务(`src/`)在 Plan C 前**不动**
- API 路径与老 TS 对齐(方便 Plan C 时切换 web/ 的 baseURL)

## 项目文件禁忌(v0.3 阶段)

- **禁改** 根目录 `src/`(TS)、`web/`、`tests/`、`package.json`
- **只在** `server/` 下工作
