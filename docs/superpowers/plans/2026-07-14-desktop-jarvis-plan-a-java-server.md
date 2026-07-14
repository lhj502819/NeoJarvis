# v0.3 Plan A · Java 服务端拆离 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`(推荐)或 `superpowers:executing-plans`。步骤用 checkbox(`- [ ]`)跟踪。

---

## Goal

按 v0.3 spec(`docs/superpowers/specs/2026-07-14-desktop-jarvis-v0.3-client-server.md`)拆出**独立 Java 服务端**——放在仓库根目录 `server/`,与现有 TS 代码并存(不动 src/ 和 web/)。服务端跑起来后能:
1. 独立 `mvn spring-boot:run` 启动,连本地/云 MySQL
2. 提供 v0.3 spec §6 定义的 REST + SSE API
3. 通过 CloudBase Auth 验证 token(替换现有 bcrypt+cookie)
4. 部署到 CloudBase 云托管(通过 git 部署,不依赖本地 Docker)

## Non-Goal

- **不动** 现有 `src/`(TS 智能层)—— 那部分是未来客户端,归 Plan B/C
- **不动** 现有 `web/`(React UI)—— Plan C 时才让它指向新 Java 服务端
- **不实现** 多设备协同的路由逻辑(spec §11 明确 v0.3 不做)
- **不实现** 手机/网页遥控端

## Tech Stack

- **Java 21 LTS**(virtual threads for SSE)
- **Spring Boot 3.x**(Spring MVC 用 SseEmitter)
- **MyBatis**(注解方式,不写 mapper.xml)
- **MySQL**(体验版兼容;driver: mysql-connector-j 9.x)
- **Maven**(pom.xml)
- **JUnit 5 + Testcontainers**(集成测试)
- **CloudBase Auth SDK**(验证 token)
- **CloudBase 云托管**(部署;git 触发构建,无需本地 Docker)

## Global Constraints

- **不动** 现有 TS 代码(src/、web/、tests/、package.json)
- **表名前缀** `jarvis_*` / `user_jarvis_*`,保持不变(与 v0.1/v0.2 老数据兼容)
- **Java package** 全部在 `com.jarvis.*` 下
- **服务端端口** 默认 8080(避开老 TS 服务的 3000)
- **CloudBase Auth** 官方 SDK 集成,不自建 JWT
- **API 路径与老 TS 对齐**(v0.3 spec §6),Plan C 才切换客户端

---

## 前置准备(不算 Task,但要跟到位)

### 环境检查

- [ ] `java --version` → 期望 `21.x`(如无请装:brew install openjdk@21 或 sdkman)
- [ ] `mvn --version` → 期望 `3.9+`
- [ ] 本地 MySQL 8.x(brew install mysql / brew services start mysql)
- [ ] CloudBase envId(已在 cloudbaserc.json):`homework-d8g3o3ljgc5ec3011`
- [ ] CloudBase MySQL 实例(去控制台建一个,拿到 host/port/user/pwd)

### 决策 recap

| # | 决策 | 值 |
|---|------|---|
| P1 | Java 版本 | 21 |
| P2 | Spring Boot 版本 | 3.3.x |
| P3 | 构建工具 | Maven |
| P4 | ORM | MyBatis(注解方式) |
| P5 | 数据库 | MySQL 8.x |
| P6 | 认证 | CloudBase Auth SDK |
| P7 | 部署 | CloudBase 云托管(git push 触发) |
| P8 | 目录 | `server/`(仓库根同级,不用 packages/) |

---

## Task 拆分总览

| # | 任务 | 依赖 | 交付 |
|---|------|------|------|
| **A0** | Spring Boot 脚手架 + Maven 项目 + health check | 无 | 空项目能 `mvn spring-boot:run` 起来,访问 `GET /api/health` 200 |
| **A1** | MySQL 连接 + 建表 DDL(17 表)+ MyBatis 配置 | A0 | 服务启动自动建表,`GET /api/health/db` 返回连接状态 |
| **A2** | CRUD API 第一批(核心 6 endpoint) | A1 | `/api/tasks`、`/api/task/:id`、`/api/recipes`、`/api/recipe/:id/subtasks`、`/api/history`、`/api/state` |
| **A3** | CRUD API 第二批(次要 7 endpoint) | A2 | `/api/artifacts`、`/api/artifact/:id`、`/api/skills`、`/api/skills/:name/toggle`、`/api/credentials`(4 端点) |
| **A4** | CloudBase Auth 集成 + auth filter | A2 | 所有 `/api/*` 除 health 外都要求 CloudBase token,验证成功注入 userId |
| **A5** | SSE 事件总线 `/api/events` | A4 | 客户端订阅能收到事件(mock 测试) |
| **A6** | CloudBase 部署 + 冒烟 | A5 | 从 git push 触发部署,拿到公网 URL,curl `GET /api/health` 200 |

---

## Task A0:Spring Boot 脚手架

**Files:**
- Create: `server/pom.xml`
- Create: `server/src/main/java/com/jarvis/JarvisServerApplication.java`
- Create: `server/src/main/java/com/jarvis/web/HealthController.java`
- Create: `server/src/main/resources/application.yml`
- Create: `server/.gitignore`(target/, .idea/, *.iml)
- Create: `server/README.md`

**Steps:**

- [ ] **Step 1: 建 pom.xml**

依赖清单:
- `spring-boot-starter-web`(REST)
- `spring-boot-starter-validation`
- `spring-boot-starter-test`(scope=test)
- 打包 `spring-boot-maven-plugin`

groupId=`com.jarvis`, artifactId=`jarvis-server`, version=`0.3.0-SNAPSHOT`, java.version=21, spring-boot.version=3.3.5(以最新 stable 为准)。

- [ ] **Step 2: 建启动类 JarvisServerApplication**

标准 `@SpringBootApplication` main。

- [ ] **Step 3: 建 HealthController**

```java
@RestController
@RequestMapping("/api")
public class HealthController {
  @GetMapping("/health")
  public Map<String, Object> health() {
    return Map.of("status", "ok", "service", "jarvis-server", "version", "0.3.0");
  }
}
```

- [ ] **Step 4: application.yml**

```yaml
server:
  port: 8080
spring:
  application:
    name: jarvis-server
logging:
  level:
    com.jarvis: DEBUG
```

- [ ] **Step 5: 冒烟**

Run: `cd server && mvn spring-boot:run`
Expected: 日志有 `Started JarvisServerApplication in X seconds`,`curl http://localhost:8080/api/health` 返回 `{"status":"ok",...}`。

- [ ] **Step 6: 提交**

```bash
git add server/
git commit -m "feat(server/A0): Spring Boot 3 脚手架 + health check"
```

---

## Task A1:MySQL 连接 + 建表 + MyBatis 配置

**Files:**
- Modify: `server/pom.xml`(加 `mysql-connector-j`、`mybatis-spring-boot-starter`、`spring-boot-starter-jdbc`)
- Modify: `server/src/main/resources/application.yml`(datasource 配置)
- Create: `server/src/main/resources/schema.sql`(17 表 DDL,从 `src/shared/db.ts` 移植 + PG→MySQL 转换)
- Create: `server/src/main/java/com/jarvis/config/DatabaseInit.java`(启动时执行 schema.sql,幂等)
- Create: `server/src/main/java/com/jarvis/web/HealthController.java`(补 `/api/health/db` 端点)
- Create: `server/src/test/java/com/jarvis/DatabaseInitTest.java`(启动时建表成功验证)

**Steps:**

- [ ] **Step 1: 依赖加入**

```xml
<dependency><groupId>com.mysql</groupId><artifactId>mysql-connector-j</artifactId></dependency>
<dependency><groupId>org.mybatis.spring.boot</groupId><artifactId>mybatis-spring-boot-starter</artifactId><version>3.0.3</version></dependency>
```

- [ ] **Step 2: application.yml datasource**

```yaml
spring:
  datasource:
    url: ${DATABASE_URL:jdbc:mysql://localhost:3306/jarvis?createDatabaseIfNotExist=true&useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai}
    username: ${DATABASE_USER:root}
    password: ${DATABASE_PASSWORD:}
    driver-class-name: com.mysql.cj.jdbc.Driver
mybatis:
  mapper-locations: classpath:mapper/*.xml
  configuration:
    map-underscore-to-camel-case: true
```

- [ ] **Step 3: schema.sql(建表)**

从 `src/shared/db.ts` 的 CREATE_SQL 逐行移植,PG → MySQL 转换:

- `SERIAL PRIMARY KEY` → `INT AUTO_INCREMENT PRIMARY KEY`(2 张表:`jarvis_claude_sessions.id`、`user_jarvis_messages.id`)
- `TEXT` 保留(MySQL 也支持;需索引字段改 `VARCHAR(191)`)
- `BIGINT` 保留(MySQL 兼容)
- `REFERENCES ... ON DELETE CASCADE` 保留
- 索引/UNIQUE 保留

补上 `ADD COLUMN IF NOT EXISTS` 迁移(5 处 subtasks 列 + skills 列 + image_ids 列 + version/updated_at/task_id 列)—— MySQL 8.0.29+ 支持 `IF NOT EXISTS`,老版本要吞异常;推荐直接写在 CREATE TABLE 里(初次建表就完整),ALTER 只在真升级场景下补。

**新增一张表**:
```sql
CREATE TABLE IF NOT EXISTS jarvis_skill_prefs (
  user_id VARCHAR(191) NOT NULL,
  skill_name VARCHAR(191) NOT NULL,
  PRIMARY KEY (user_id, skill_name)
);
```

- [ ] **Step 4: DatabaseInit(启动执行 schema.sql)**

用 `ResourceLoader` 读 classpath:schema.sql,`JdbcTemplate.execute` 一次执行。用 `@PostConstruct` 或 `ApplicationRunner` 触发。幂等靠 `CREATE TABLE IF NOT EXISTS`。

- [ ] **Step 5: HealthController 补 /api/health/db**

```java
@GetMapping("/health/db")
public Map<String, Object> healthDb(JdbcTemplate jdbc) {
  Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM jarvis_users", Integer.class);
  return Map.of("status", "ok", "users_count", count);
}
```

- [ ] **Step 6: 集成测试**

```java
@SpringBootTest
class DatabaseInitTest {
  @Autowired JdbcTemplate jdbc;
  @Test void allTablesCreated() {
    for (String table : List.of("jarvis_users", "jarvis_tasks", /* ... 17 张 */)) {
      Integer c = jdbc.queryForObject(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",
        Integer.class, table);
      assertEquals(1, c, "table " + table + " missing");
    }
  }
}
```

用 `application-test.yml` 指向本地 MySQL 测试库(如 `jarvis_test`)。

- [ ] **Step 7: 冒烟**

启动服务 → `curl http://localhost:8080/api/health/db` 应返回 `{"status":"ok","users_count":0}`;`mysql -e "SHOW TABLES FROM jarvis"` 应看到 17 张表。

- [ ] **Step 8: 提交**

```bash
git add server/
git commit -m "feat(server/A1): MySQL + MyBatis + 17 表建表 + /api/health/db"
```

---

## Task A2:CRUD API 第一批(核心 6 endpoint)

**Files:**
- Create: `server/src/main/java/com/jarvis/domain/` 下每 entity 一个类(Task, Subtask, Recipe, State, AgentSession, ...)
- Create: `server/src/main/java/com/jarvis/mapper/` 下每张表一个 MyBatis mapper interface(注解方式,不写 xml)
- Create: `server/src/main/java/com/jarvis/service/` 业务层
- Create: `server/src/main/java/com/jarvis/web/` 控制器
- Create: `server/src/test/java/com/jarvis/web/*ControllerTest.java`(MockMvc)

**Endpoints(参照 `src/jarvis/routes/dashboard.ts` 逻辑逐个 port):**

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/tasks?since=` | 拉任务列表 |
| GET | `/api/task/:taskId` | 拉单任务详情(带 subtasks + turns) |
| GET | `/api/recipes` | 系统 recipe + 用户 recipe |
| GET | `/api/recipe/:recipeId/subtasks` | 某 recipe 执行过的子任务 |
| GET | `/api/history` | 历史 agent sessions |
| GET | `/api/state` | Jarvis 人格状态 |
| PATCH | `/api/state` | 改 mood/energy/... |

**Steps:**

- [ ] **Step 1: 建 domain 层(POJO,一表一类)**

用 Java 21 records 建 immutable DTO;可变实体用 class + Lombok(可选,或纯 getter/setter)。字段跟表 DDL 一一对应,时间列用 `String`(现有 TS 也用 ISO string,兼容)。

- [ ] **Step 2: 建 mapper 接口(注解 SQL)**

```java
@Mapper
public interface TaskMapper {
  @Select("SELECT * FROM jarvis_tasks WHERE user_id=#{userId} AND updated_at > #{since} ORDER BY updated_at DESC")
  List<Task> listSince(@Param("userId") String userId, @Param("since") String since);

  @Select("SELECT * FROM jarvis_tasks WHERE id=#{id}")
  Task findById(@Param("id") String id);
  // ...
}
```

- [ ] **Step 3: 建 service 层**

Service 里做业务逻辑(如 task detail 要合并 subtasks + turns),转发给 mapper。

- [ ] **Step 4: 建 controller**

每个 controller 一个 `@RestController`,标注路径。**先允许无 auth**(A4 才加 filter),用 header `X-User-Id` 从请求拿 userId(方便 A4 之前手工测试)。

- [ ] **Step 5: 测试**

`@WebMvcTest` + `MockMvc` 打请求,mock service 返回预期数据,断言 JSON shape 与老 TS 一致。

关键测试用例:
- `GET /api/tasks` 空列表
- `GET /api/tasks?since=X` 增量正常
- `GET /api/task/:id` 存在 → 200 + task 详情;不存在 → 404
- `GET /api/state` 无记录 → 返回默认(mood=80 energy=90 ...);有记录 → 返回记录
- `PATCH /api/state` 更新字段 → 落库

- [ ] **Step 6: 冒烟(比对老 TS)**

启动 Java 服务 + 老 TS 服务(端口 3000),各自 curl 同一批数据,JSON 应当一致(至少 shape)。

- [ ] **Step 7: 提交**

```bash
git add server/
git commit -m "feat(server/A2): CRUD API 第一批(tasks/recipes/history/state)"
```

---

## Task A3:CRUD API 第二批(次要 7 endpoint)

**Endpoints:**

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/artifacts` | 制品列表(query: q=, type=, limit=) |
| GET | `/api/artifact/:id` | 制品详情(含 content) |
| POST | `/api/artifacts` | 创建制品 |
| GET | `/api/skills` | 用户可见 skill 清单(合并个人 + 内置) |
| POST | `/api/skills/:name/toggle` | 启禁 skill |
| GET | `/api/credentials` | BYOK 凭证列表(不返 api_key_enc) |
| POST | `/api/credentials` | 新增凭证 |
| PUT | `/api/credentials/:id` | 更新凭证 |
| DELETE | `/api/credentials/:id` | 删除 |

**Steps:**
仿 A2 结构,一个个 port。credentials 涉及加密解密(TS 里用 AES),Java 侧对应 `javax.crypto` 实现;密钥来自 env `CREDENTIAL_ENC_KEY`。

- [ ] Artifact 相关(3 endpoint + service + mapper)
- [ ] Skill 相关(2 endpoint + skill-prefs mapper;skills 列表本身是"个人 skills-hub 扫描 + 用户黑名单过滤",skills-hub 逻辑归客户端,服务端只管黑名单表)
- [ ] Credential 相关(4 endpoint + crypto 工具类 + mapper)
- [ ] `/api/conversation`(用户↔Jarvis 消息列表)
- [ ] `/api/chat-image/:id`(base64 图片存取)
- [ ] 单测 + 冒烟
- [ ] 提交:`feat(server/A3): CRUD API 第二批(artifacts/skills/credentials/conversation)`

**技能列表的说明**:
- 老 TS 里 `/api/skills` 返回的是"skills-hub 扫描本机 + 黑名单过滤"的合并结果
- **服务端不能扫本机 skills** —— 那是客户端行为
- 服务端只提供"黑名单表 CRUD"(`/api/skills/prefs`),客户端自己扫本机 → 合并黑名单 → 展示
- 因此 `/api/skills` 服务端只返回**黑名单列表**(用户禁用的 skill 名单),不再合并 skills-hub 结果

---

## Task A4:CloudBase Auth 集成 + auth filter

**Files:**
- Create: `server/src/main/java/com/jarvis/auth/CloudBaseAuthFilter.java`(OncePerRequestFilter)
- Create: `server/src/main/java/com/jarvis/auth/UserContext.java`(ThreadLocal userId)
- Create: `server/src/main/java/com/jarvis/config/SecurityConfig.java`(Spring Security 配置)
- Modify: `server/pom.xml`(加 `spring-boot-starter-security`)
- Modify: 所有 controller 移除 `X-User-Id` 手工传,改用 `UserContext.currentUserId()`
- Create: `server/src/test/java/com/jarvis/auth/CloudBaseAuthFilterTest.java`

**关键设计:**
- **v0.3 不实际启用 CloudBase Auth**(spec §11 明确不做多设备,单机场景当前 web/ 已有登录逻辑,Plan C 时再切)
- 但**架构上留好接口**:filter 存在,只是在 dev profile 下"任何 token 都放行,注入固定 userId"
- 生产 profile 下走 CloudBase 真验证

**Steps:**

- [ ] Filter 骨架:验证 header `Authorization: Bearer <token>` → 拿 userId → 注入 `UserContext`
- [ ] 两个 profile:
  - `dev`(默认):任何 token 均视为 userId="local"(继承 v0.1 单用户旁路)
  - `prod`:调 CloudBase Auth SDK `verifyToken()`,失败返 401
- [ ] SecurityConfig 排除 `/api/health*` 从鉴权
- [ ] `/api/auth/callback` endpoint 保留占位(CloudBase 登录回调,v0.4 才真接)
- [ ] 老 TS 里 `jarvis_users` 表继续用作 `cloudbase_uid → 内部 userId` 映射(需要新增 `cloudbase_uid` 列 —— schema.sql 补上)
- [ ] 测试:
  - dev profile 无 token → 200 + userId="local"
  - prod profile 假 token → 401
- [ ] 冒烟 + 提交:`feat(server/A4): auth filter + CloudBase Auth 挂钩位`

---

## Task A5:SSE 事件总线

**Files:**
- Create: `server/src/main/java/com/jarvis/sse/EventBus.java`(内存 fanout,per-user)
- Create: `server/src/main/java/com/jarvis/sse/EventController.java`(`GET /api/events`)
- Create: `server/src/main/java/com/jarvis/sse/EventPublisher.java`(供其他 service 调用 publish)
- Create: `server/src/test/java/com/jarvis/sse/EventBusTest.java`

**关键设计:**
- 每个 SSE 连接注册到 EventBus,以 userId 为 key 分组
- 其他 service 想推事件 → 调 `EventPublisher.publish(userId, event)` → EventBus fanout 给该用户所有 SseEmitter
- 事件带 `{ eventId, type, sourceDeviceId, targetDeviceId?, payload, timestamp }`(spec §6.2)
- 断连自动清理

**Steps:**

- [ ] EventBus 实现(ConcurrentMap<String, List<SseEmitter>>,用 `emitter.onCompletion` / `.onTimeout` / `.onError` 清理)
- [ ] EventController 接受订阅,返回 `SseEmitter`(timeout 设 30 分钟,SSE 客户端要自动重连)
- [ ] EventPublisher 单例 bean
- [ ] 单测:
  - 订阅 → EventBus 记录一个
  - publish → SseEmitter 收到
  - 断连 → EventBus 清理
- [ ] 手工验证:
  ```bash
  curl -N http://localhost:8080/api/events # 一个终端订阅
  curl -X POST http://localhost:8080/api/test/publish -d '{"type":"foo"}' # 另一个终端触发
  ```
- [ ] 提交:`feat(server/A5): SSE 事件总线 + /api/events + EventPublisher`

---

## Task A6:CloudBase 部署 + 冒烟

**Files:**
- Create: `server/Dockerfile`(可选;CloudBase 会自动生成,但建议自己写)
- Modify: `cloudbaserc.json`(加 server 部署配置)
- Create: `server/README.md` 补部署章节

**Steps:**

- [ ] **Step 1: 建 Dockerfile**

```dockerfile
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY target/jarvis-server-0.3.0-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

或用 CloudBase 官方 Java 模板(自动 mvn package + Java 21 runtime)。

- [ ] **Step 2: 云 MySQL 建库**

CloudBase 控制台 → 云数据库 → 建 MySQL 实例 → 建 database `jarvis` → 拿到内网 host/port/user/pwd → 记录。

- [ ] **Step 3: cloudbaserc.json 加 server 插件**

```json
"server": {
  "use": "@cloudbase/framework-plugin-container",
  "inputs": {
    "serviceName": "jarvis-server",
    "servicePath": "/",
    "localAbsolutePath": "./server",
    "cpu": 0.25,
    "mem": 0.5,
    "minNum": 1,
    "maxNum": 1,
    "envVariables": {
      "DATABASE_URL": "jdbc:mysql://<内网 host>:3306/jarvis?...",
      "DATABASE_USER": "...",
      "DATABASE_PASSWORD": "...",
      "SPRING_PROFILES_ACTIVE": "prod"
    }
  }
}
```

- [ ] **Step 4: 部署**

```bash
cd server && mvn clean package
cloudbase framework:deploy
```

- [ ] **Step 5: 冒烟**

拿到 CloudBase 分配的 URL(https://xxx.tcloudbaseapp.com),`curl` /api/health、/api/health/db 应 200。

- [ ] **Step 6: 提交**

```bash
git add server/Dockerfile cloudbaserc.json
git commit -m "feat(server/A6): CloudBase 云托管部署配置 + 冒烟通过"
```

---

## 验收标准

- [ ] `mvn test` 全绿
- [ ] `mvn spring-boot:run` 本地起服,17 张表建全
- [ ] curl 所有 endpoint 返回预期 JSON shape
- [ ] `/api/events` 订阅+推送手工验证通过
- [ ] `cloudbase framework:deploy` 部署成功
- [ ] 公网 URL 的 `/api/health` 200
- [ ] 老 TS 服务(src/)**依然能跑**(未受影响)—— `npm run dev` 无异常

## 不做(明确保留在 Plan B/C)

- 老 TS 服务(src/)的迁移或废弃
- web/ 前端指向新 Java 服务(要等 Plan C)
- Electron 打包(Plan B)
- Jarvis brain / SDK / factory 挪进 Electron 主进程(Plan C)
- 多设备协同的实际实现(spec §11 明确 v0.4)

## 风险清单

| # | 项 | 级别 | 缓解 |
|---|----|------|------|
| R1 | MySQL DDL 从 PG 移植的语法错误 | 🟡 | 本地测试库先建过一次;不满足 MySQL 8 特性的地方(如 IF NOT EXISTS)加 try-catch |
| R2 | CloudBase MySQL 网络白名单/内网连接问题 | 🟡 | 部署前手动 telnet 验证;必要时配 VPC |
| R3 | Java 21 在公司电脑没有 | 🟢 | sdkman/brew 装 |
| R4 | Spring Boot 3 → CloudBase 兼容性 | 🟢 | 官方支持 fat jar 部署 |
| R5 | MyBatis 注解 SQL 与 TS 老 SQL 结果 shape 偏差 | 🟡 | 每 endpoint 都对比老 TS 输出 |
| R6 | 加密密钥(BYOK)迁移 | 🟡 | env `CREDENTIAL_ENC_KEY` 与老 TS 侧一致(Plan C 时统一) |
