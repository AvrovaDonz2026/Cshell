# 兼容性清单

这份清单区分三类结论：**源码对齐**表示按固定上游提交核对了路径或协议；**mock 已测试**表示本仓库的本地模拟服务覆盖了请求字节和响应；**live 已验证**表示已在真实 Sub2API 实例上通过真实 HTTP 请求验证。没有把源码对齐写成真实服务已联通。

## 真实后端双版本 CI 门槛

CI 对每组 API 契约同时跑两个后端版本，两组都通过才算通过：

| 矩阵项 | 后端来源 | 不可变标识 | 构建/解析方式 |
|--------|----------|------------|----------------|
| `baseline-source` | 固定提交源码 | commit `2af3f1e15c98c893a89255a037f551046883b8c0` | `git clone` + `git fetch --depth 1` + 校验 `rev-parse HEAD`，用上游 `deploy/Dockerfile` 构建镜像 |
| `latest-image` | 官方部署镜像 | 每轮解析的 `image@sha256:…` | 解析 `docker.io/weishaw/sub2api:latest` 的 linux/amd64 digest，启动时只用 digest 引用 |

- `latest` 每轮重新解析 digest：优先 Docker Registry API（`auth.docker.io` → `registry-1.docker.io`），失败则回退 `docker buildx imagetools inspect --raw` 或 `podman manifest inspect`。浮动 tag `:latest` 只用于解析，不作为运行引用。
- 两个矩阵项使用同一套脚本、同一套测试契约、同一组 `postgres:16` / `redis:7` 版本，唯一变量是后端版本。
- `fail-fast: false`：一组失败不掩盖另一组结论。
- 聚合门槛 `ci-required` 使用 `if: always()`，任一依赖 job 结果不是 `success`（含 `failure`、`cancelled`、`skipped`）即失败。分支保护应把 `ci-required` 配为必需检查；工作流本身不修改分支保护设置。
- 触发：`push` 到 `main`、`pull_request`、每日 `schedule`（`17 4 * * *`）与 `workflow_dispatch`。工作流只有 `permissions: contents: read`，无 `continue-on-error`。

### 已实测的网络与镜像事实

在 2026-11-24 本机（podman 5.4.2，无 docker CLI）实测：

- `docker.io/weishaw/sub2api:latest` 是多架构 index；linux/amd64 平台 digest 为
  `sha256:a532a5f09005081338bd2d503a6f463aef941f3c382dbc8637163c7230c42146`
  （index digest `sha256:f4dcb7e9cc0f0d4006abb425391c9521331013764720f08b0f111059d6a78e18`）。
  该 digest 会随上游重新发布而变化，每轮 CI 重新解析并记入 manifest。
- `latest-image` 模式已在本机用 podman 完整跑通：解析 digest → 创建隔离 bridge 网络 →
  启动 postgres/redis → 按 digest 启动上游 → `/health` 在 4.4 秒内通过（3 次轮询）。
- `configure` 已在本机对真实实例跑通：管理员登录、自动接受管理员合规承诺、
  写入并读回系统设置、public settings 校验、支付配置与 provider 列表校验。
- `scripts/sub2api-integration.mjs` 的全部 21 项检查已通过真实 Cshell（`target/debug/cshell`）
  代理对真实后端执行成功，包含注册开放与注册关闭两种 `CI_REGISTRATION_ENABLED` 路径。

## 构建内存上限（GitHub run 45366350441 失败原因与修复）

**现象**：GitHub Actions run 45366350441 的 `Real pinned Sub2API integration` job 在
`Build pinned Sub2API image` 步骤失败，上游 `pnpm run build` 报
`FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`，进程 `exit 134`。

**根因**：固定提交的 `deploy/Dockerfile` 在 frontend-builder 阶段硬编码
`ENV NODE_OPTIONS=--max-old-space-size=1536`。1.5 GiB 堆在生产构建（Vue + vue-tsc）时不够，Node 触发堆上限后 abort。

**修复**（`scripts/sub2api-ci-upstream.mjs`）：克隆后复制 Dockerfile 到
`deploy/Dockerfile.cshell-ci`，用 `patchDockerfileForMemory()` 把那一行替换为

```dockerfile
ARG CSHELL_BUILD_NODE_OPTIONS=--max-old-space-size=4096
ENV NODE_OPTIONS=${CSHELL_BUILD_NODE_OPTIONS}
```

构建命令带 `--build-arg CSHELL_BUILD_NODE_OPTIONS=<值>`，默认 4096 MiB，可用
`SUB2API_BUILD_NODE_OPTIONS` 或 `--node-options` 提高（CI 里设为 4096）。

**为什么必须换名**：本机实测确认，新增 `ARG NODE_OPTIONS=…` 不会生效——Dockerfile 中先出现的
`ENV NODE_OPTIONS` 会遮蔽同名 ARG，构建出的容器仍拿到 1536。改用 `CSHELL_BUILD_NODE_OPTIONS`
后实测：默认构建得到 `--max-old-space-size=4096`，传 `--build-arg` 时得到传入值。
单元测试锁定这一行为，防止以后改回同名 ARG 而静默失效。

**未降级处理**：没有跳过构建、没有用 `latest` 镜像替换 `baseline-source` 组、没有把 OOM 归因于偶发网络。若上游 Dockerfile 未来删除该 marker，`patchDockerfileForMemory()` 会直接报错要求人工复核，而不是悄悄沿用低内存。

**本机限制**：宿主 7.2 GiB 内存、8 核，完整 baseline 源码构建在本机被宿主内存压力终止（非 Dockerfile 问题）。CI runner 内存更充裕，这也是把内存上限提高到 4 GiB 的前提；本机未拿到完整的 baseline 端到端成功记录，此处如实标注。

## 隔离运行与命名

`scripts/sub2api-ci-upstream.mjs` 是唯一的后端供给路径（两个模式共用，不使用 GH `services:` 以免双重供给）：

- 每次尝试创建独立的 bridge 网络，名字由 `GITHUB_RUN_ID`/`GITHUB_RUN_ATTEMPT` 加随机后缀派生；本地无这两个变量时用 `local-<随机>`。
- postgres 与 redis 只有网络内别名，**不发布任何宿主机端口**，不使用 host 网络。
- 上游容器在网络内别名为 `sub2api`，容器内监听 `18081`；宿主侧只把该端口发布到 `127.0.0.1` 的随机空闲端口，供 Cshell 与测试脚本访问。
- 数据目录用 per-attempt 命名卷，可写；`/tmp`、`/run` 为 tmpfs。
- `AUTO_SETUP=true` 触发上游自动初始化；`ADMIN_EMAIL`/`ADMIN_PASSWORD`/`JWT_SECRET` 来自环境或现场生成；postgres 密码与 JWT secret 每次随机生成。
- 有界健康等待：postgres/redis 用容器 healthcheck，上游轮询 `/health`，超时即抓日志并失败。
- `down` 删除容器、卷与网络；workflow 用 `if: always()` 调用，失败也清理。
- 资源名带 run/attempt 后缀，重跑不冲突。

## 管理员配置（只用真实管理 API）

`configure` 只用从固定提交后端路由核实的端点，不发明接口：

| 步骤 | 端点 | 依据 |
|------|------|------|
| 管理员登录 | `POST /api/v1/auth/login` | `routes/auth.go` |
| 合规状态/接受 | `GET /api/v1/admin/compliance`、`POST /api/v1/admin/compliance/accept` | `routes/admin.go` `registerAdminComplianceRoutes`、`middleware/admin_compliance.go`（未接受时管理面返回 423） |
| 读系统设置 | `GET /api/v1/admin/settings` | `registerSettingsRoutes` |
| 写系统设置 | `PUT /api/v1/admin/settings` | `setting_handler_update.go` `UpdateSettingsRequest` |
| public 校验 | `GET /api/v1/settings/public` | `routes/auth.go` + `GetPublicSettings` |
| 支付配置 | `GET/PUT /api/v1/admin/payment/config` | `routes/payment.go` |
| 支付 provider | `GET /api/v1/admin/payment/providers` | 同上 |

写入内容（`buildSettingsPayload()`）：开启 `registration_enabled`（按 `CI_REGISTRATION_ENABLED`
取 true/false）、关闭 `email_verify_enabled`、清空 SMTP 字段、关闭 turnstile/腾讯/阿里云验证码、
关闭邀请码与登录协议。写后必须读回并逐字段比对；`PUT` 是全量语义，但后端对未发送的
value 型字段保持原值（`omittedSettingKeys`），所以只发送需要变更的字段。

**明确失败而不猜测**：读回时缺少必需字段、字段值与期望不符、公网设置仍报告验证码开启、
支付配置读取失败、provider 列表非空——任一情况直接非零退出并给出字段名，绝不静默继续。
不支持的配置（例如上游改成需要无法自动化的二次确认）会使 job 失败，而不是降低断言。

**不做的真实外部动作**：不发送邮件（`email_verify_enabled=false` 且无 SMTP）、不调用真实验证码
供应商、不配置真实支付 provider、不发起真实支付或模型调用。支付失败路径是在**禁用**状态下验证的
拒绝语义；成功支付流程仍只由 mock 场景覆盖，两类结果在报告中分开。

## 真实协议检查（`scripts/sub2api-integration.mjs`）

所有请求经真实 Cshell 同源代理 `/api/v1/*` 打到真实后端。断言同时看 HTTP 状态与业务 envelope：

- 未认证访问 `/api/v1/user/profile` 与 `/api/v1/admin/users` 返回 401/403。
- 管理员登录并可读 `/api/v1/admin/users`（提供 admin 凭证时）。
- 普通用户登录：`code === 0`，`access_token`/`refresh_token`/`expires_in`/`user.email` 齐备。
- `/api/v1/user/profile` 身份与测试账号一致，且 role 不是 admin。
- `/api/v1/auth/refresh` 轮换后的 access token 能读到同一账号。
- 注册门控：`/api/v1/settings/public.registration_enabled` 与 `CI_REGISTRATION_ENABLED` 一致；
  开启时用唯一邮箱注册成功，关闭时返回 403 且 envelope code 非 0。
- 普通用户访问 `/api/v1/admin/users` 返回 403，envelope `code` 为 `FORBIDDEN`。
- API Key：创建（唯一名 + quota + `10.0.0.0/8` CIDR 白名单）→ 列表 total +1 → 单项读取 →
  改名改状态 → 非法 quota（`-1`）返回 400 → 非法 CIDR 返回 400 → 删除 → 再读取 404。
- 用量：`dashboard/stats` 的 `total_requests === 0`；`dashboard/trend` 的 `trend` 为空且回显
  `start_date`/`end_date`/`granularity`；`/usage` 空列表；`subscriptions/summary` 有
  `active_count` 与数组。没有真实模型请求时不伪造有量统计。
- 支付：`config` 显示 `enabled === false`；`checkout-info`/`plans`/`limits` 正常响应；
  禁用状态下创建订单返回 403，且 `orders/my` 计数不变、列表为空、无订单副作用；
  未知 `out_trade_no` 的 public verify 返回 404。

`assertRejected()` 要求 **HTTP 4xx 且 envelope code 非 0**；“返回的是 JSON”或“200 带错误码”都不通过。

## 脱敏

- `sanitize()` 在 `scripts/sub2api-ci-upstream.mjs` 中集中处理：先按已知密钥值逐字替换，再按
  `password|secret|token|api_key|authorization` 赋值形态与 `Bearer` 头替换；对象递归处理，
  密钥命名键直接置为 `[REDACTED]`。
- 镜像 digest 不脱敏——它是可复核的测量值，必须保留在 manifest 里。
- `scripts/sub2api-integration.mjs` 有独立脱敏：除密码外，额外遮蔽 `sk-…`、`rt_…`、JWT 形态。
- 失败摘要只打印 status/code（`redactBody()`），不打印请求体或密钥。
- manifest 落盘到 `$RUNNER_TEMP/sub2api-manifest.json`（`--manifest` 可改），stdout 只输出一行 JSON；人类可读日志走 stderr。

## 命令

```sh
# 解析版本（不启动容器）
CONTAINER_ENGINE=podman node scripts/sub2api-ci-upstream.mjs resolve --mode latest-image
node scripts/sub2api-ci-upstream.mjs resolve --mode baseline-source --source-dir "$RUNNER_TEMP/sub2api-upstream"

# 供给并等待健康
SUB2API_ADMIN_EMAIL=… SUB2API_ADMIN_PASSWORD=… \
  node scripts/sub2api-ci-upstream.mjs up --mode latest-image --manifest "$RUNNER_TEMP/sub2api-manifest.json"

# 通过真实管理 API 配置并读回校验
SUB2API_ADMIN_EMAIL=… SUB2API_ADMIN_PASSWORD=… CI_REGISTRATION_ENABLED=true \
  node scripts/sub2api-ci-upstream.mjs configure --manifest "$RUNNER_TEMP/sub2api-manifest.json"

# 查询 manifest / 清理
node scripts/sub2api-ci-upstream.mjs manifest --manifest "$RUNNER_TEMP/sub2api-manifest.json"
node scripts/sub2api-ci-upstream.mjs down --manifest "$RUNNER_TEMP/sub2api-manifest.json"

# 真实协议检查（Cshell 已在 18080 运行）
CSHELL_BASE_URL=http://127.0.0.1:18080 \
SUB2API_TEST_EMAIL=… SUB2API_TEST_PASSWORD=… \
SUB2API_ADMIN_EMAIL=… SUB2API_ADMIN_PASSWORD=… \
  node scripts/sub2api-integration.mjs

# 纯函数单测
node --check scripts/sub2api-ci-upstream.mjs
node --test scripts/sub2api-ci-upstream.test.mjs
```

`CONTAINER_ENGINE` 默认 `docker`，找不到时回退 `podman`。postgres/redis 镜像用完全限定名
（`docker.io/library/postgres:16` 等），因为本机 podman 没有配置短名搜索仓库。

## CI job 图

```
rust ─┬─> proxy-smoke ─┐
      │                │
      ├─> docker ──────┤
      │                ├─> ci-required (if: always(), 任一非 success 即失败)
web ──┤                │
      ├─> sub2api-integration [baseline-source, latest-image] ──┤
      └─> sub2api-browser     [baseline-source, latest-image] ──┘
harness-tests ─────────────────────────────────────────────────┘
```

`rust` 上传 `target/debug/cshell`，`web` 上传 `web/dist`；两个真实后端 job 下载后用同一二进制、
同一 bundle 运行，不重复编译。

## 已核对的源码对齐项

基线为 [sub2api `2af3f1e15c98c893a89255a037f551046883b8c0`](https://github.com/Wei-Shaw/sub2api/tree/2af3f1e15c98c893a89255a037f551046883b8c0)。上游的 Vue Router 包含 `/login`、`/register`、`/auth/*/callback`、`/dashboard`、`/keys`、`/purchase`、`/orders`、`/payment/*`、`/admin/*` 和 `/setup` 等路径。Cshell 只为用户页面白名单提供 `/_cshell/` 静态资源和 SPA 回退；`/admin`、`/setup`、未知路径及 API 由上游处理。

上游认证 API 位于 `/api/v1/auth`，包括登录、注册、刷新、登出、Passkey begin/finish、当前用户和 OAuth 回调。前端用浏览器 `localStorage` 的 `auth_token`、`refresh_token`、`auth_user` 访问同源 API，并在请求中发送 Bearer token。Cshell 保留这些路径、请求体、认证头和浏览器同源关系。

支付源码对齐的用户接口包括 `/api/v1/payment/config`、`checkout-info`、`plans`、`limits`，订单创建、查询、取消、退款申请，以及 `/api/v1/payment/public/orders/verify`、`resolve`。通知路径包括 `/api/v1/payment/webhook/easypay`、`alipay`、`wxpay`、`stripe` 和 `airwallex`。管理员支付接口位于 `/api/v1/admin/payment/*`，继续由上游的管理员鉴权处理。

## mock 合同覆盖

本地合同测试用 `scripts/mock-sub2api.mjs` / `scripts/cshell-web-fixture.mjs` 覆盖请求字节和
响应形状，包括支付成功、`order_created`/`oauth_required`/`jsapi_ready` 结果类型、verify 与
resolve 的不同响应类型。mock 结果**不能**替代真实兼容性结论；成功支付、真实邮件、真实验证码
和真实 provider 只在 mock 中覆盖。

## live 未验证的上线项

部署到真实环境前，在最终公开 HTTPS origin 完成以下检查：

- 上游登录、刷新、登出、注册、邮箱验证、Passkey 和每个启用的 OAuth 提供商；检查浏览器存储、Cookie、回调查询参数和错误回跳。
- 用户 API key、模型列表、流式网关、MCP OAuth、图片/文件能力和 `/admin` 全部从 Cshell 入口访问。
- 支付沙箱的订单创建、用户返回页、异步 webhook、重复通知、超时、退款和余额/订阅履约。确认供应商登记的回调地址保留原路径、方法、查询参数和签名输入。
- HTTPS 反向代理的 Host、scheme、真实客户端 IP、WebSocket/流式响应、超时和请求体大小。配置 `CSHELL_TRUSTED_PROXY_CIDRS` 只信任实际入口网段，并在 Sub2API 中核对 `server.trusted_proxies`。
- CSP、Passkey RP ID/origin、支付 iframe、第三方脚本和浏览器隐私策略。不要把令牌、Cookie 或签名回调写入代理日志。

## 不在本次 CI 范围

- 真实支付扣费、真实邮件投递、真实验证码供应商校验、真实模型推理调用。
- 生产凭证：CI 只用临时随机凭证，不使用任何生产 secret。
- 推送镜像、创建 release、修改分支保护。工作流只有 `contents: read`。
- 浏览器闭环的真实后端覆盖由同级任务提供的 `scripts/sub2api-browser.mjs` 承担；本文件描述的后端矩阵
  与 `sub2api-integration` 只覆盖 HTTP 协议层。

## 发布前记录

填写真实环境结果，保留日期、Cshell commit、Sub2API 版本（固定 commit 或解析到的 digest）、
入口域名和沙箱/生产标识。把“通过”限定为实际执行过的项；未运行的项写“未验证”，不要以 mock
结果替代 live 结果。
