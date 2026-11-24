# 兼容性清单

这份清单区分三类结论：**源码对齐**表示按固定上游提交核对了路径或协议；**mock 已测试**表示本仓库的本地模拟服务覆盖了请求字节和响应；**live 未验证**表示仍需在实际 Sub2API、身份提供商或支付沙箱中验证。没有把源码对齐写成真实服务已联通。

## 已核对的源码对齐项

基线为 [sub2api `2af3f1e15c98c893a89255a037f551046883b8c0`](https://github.com/Wei-Shaw/sub2api/tree/2af3f1e15c98c893a89255a037f551046883b8c0)。上游的 Vue Router 包含 `/login`、`/register`、`/auth/*/callback`、`/dashboard`、`/keys`、`/purchase`、`/orders`、`/payment/*`、`/admin/*` 和 `/setup` 等路径。Cshell 只为用户页面白名单提供 `/_cshell/` 静态资源和 SPA 回退；`/admin`、`/setup`、未知路径及 API 由上游处理。

上游认证 API 位于 `/api/v1/auth`，包括登录、注册、刷新、登出、Passkey begin/finish、当前用户和 OAuth 回调。前端用浏览器 `localStorage` 的 `auth_token`、`refresh_token`、`auth_user` 访问同源 API，并在请求中发送 Bearer token。Cshell 保留这些路径、请求体、认证头和浏览器同源关系。

支付源码对齐的用户接口包括 `/api/v1/payment/config`、`checkout-info`、`plans`、`limits`，订单创建、查询、取消、退款申请，以及 `/api/v1/payment/public/orders/verify`、`resolve`。通知路径包括 `/api/v1/payment/webhook/easypay`、`alipay`、`wxpay`、`stripe` 和 `airwallex`。管理员支付接口位于 `/api/v1/admin/payment/*`，继续由上游的管理员鉴权处理。

## mock 合同覆盖与执行状态

以下为仓库合同测试的覆盖目标；此文档编写阶段尚无完整通过的执行记录，因此不能标为“mock 已测试通过”。最终执行结果应单独记录。

- `GET /api/v1/auth/me`：Bearer Authorization 透传，响应 envelope 原样返回。
- `POST /api/v1/auth/login`：JSON 请求体字节透传，登录 token 响应保持原样。
- `POST /api/v1/payment/public/orders/verify`：未登录订单核验请求保持原方法、路径、请求体。
- `GET /_cshell/ready`：向上游 `/health` 探测并根据成功状态返回 ready。
- 用户 SPA 页面（例如 `/payment/result`）：从本地 `web/dist/index.html` 服务，不访问上游。
- 未被 UI 白名单允许的 API：转发到上游；mock 拒绝意外请求时，Cshell 返回错误而不是静默访问其他服务。

运行 Rust 合同测试需要 Rust toolchain 和 Node.js；测试会启动 `scripts/mock-sub2api.mjs`，不会连接真实 Sub2API。测试内容代表 mock 合同覆盖，不代表第三方 OAuth、Passkey 或支付结果已完成。

## live 未验证的上线项

部署到真实环境前，在最终公开 HTTPS origin 完成以下检查：

- 上游登录、刷新、登出、注册、邮箱验证、Passkey 和每个启用的 OAuth 提供商；检查浏览器存储、Cookie、回调查询参数和错误回跳。
- 用户 API key、模型列表、流式网关、MCP OAuth、图片/文件能力和 `/admin` 全部从 Cshell 入口访问。
- 支付沙箱的订单创建、用户返回页、异步 webhook、重复通知、超时、退款和余额/订阅履约。确认供应商登记的回调地址保留原路径、方法、查询参数和签名输入。
- HTTPS 反向代理的 Host、scheme、真实客户端 IP、WebSocket/流式响应、超时和请求体大小。配置 `CSHELL_TRUSTED_PROXY_CIDRS` 只信任实际入口网段，并在 Sub2API 中核对 `server.trusted_proxies`。
- CSP、Passkey RP ID/origin、支付 iframe、第三方脚本和浏览器隐私策略。不要把令牌、Cookie 或签名回调写入代理日志。

## 发布前记录

填写真实环境结果，保留日期、Cshell commit、Sub2API 版本、入口域名和沙箱/生产标识。把“通过”限定为实际执行过的项；未运行的项写“未验证”，不要以 mock 结果替代 live 结果。

## 本次文档任务的验证边界

Compose 文件已通过 YAML 解析与关键字段检查。宿主机未提供 Docker CLI，未执行 Docker 镜像构建、Compose 启动或容器只读运行验证；Podman 可用不等于已完成这些验证。Rust 源码在其他任务中持续更新，本任务不以中间编译结果声明测试通过；最终 mock 执行结果请结合发布时的测试输出记录。真实 Sub2API、身份提供商和支付沙箱均未在本任务中验证。


## 双版本后端 CI 门槛（2026-11-24 新增）

CI 的真实后端联动以 `sub2api-integration`（API 协议）与 `sub2api-browser`（生产前端浏览器）双矩阵运行，后端版本为：

- `baseline-source`：固定提交 `2af3f1e15c98c893a89255a037f551046883b8c0` 源码构建；构建时以 `NODE_OPTIONS=--max-old-space-size=4096` 限定上游前端堆内存（此前 Actions 默认 2GB 出现 exit 134 OOM）。
- `latest-image`：每轮解析 `docker.io/weishaw/sub2api:latest` 的 linux/amd64 digest，并以 `image@sha256:…` 启动，测试期间不回退到浮动标签。

两组矩阵均通过 [scripts/sub2api-ci-upstream.mjs](scripts/sub2api-ci-upstream.mjs) 在独立 bridge 网络内启动 postgres:16 + redis:7 + Sub2API，不向宿主机发布数据库端口；管理员账号、JWT 密钥每次随机生成并集中脱敏。`configure` 命令通过真实管理 API 开放邮箱注册并读回校验；未证实的管理字段会直接失败，不做静默降级。

每个联动任务经真实 Cshell 代理运行 [scripts/sub2api-integration.mjs](scripts/sub2api-integration.mjs)（未认证拒绝、登录、profile、refresh、权限隔离、Key 生命周期、用量空态、订阅/支付只读端点、未知订单拒绝）和 [scripts/sub2api-browser.mjs](scripts/sub2api-browser.mjs)（生产 `web/dist`：访客首页、登录、Key CRUD、资料修改、热力图、主题/语言持久化、管理员跳转上游、支付页不声明已支付、无横向溢出）。

聚合 job `ci-required` 以 `always()` 汇总全部任务，任何失败/取消/跳过都会令 CI 失败；应将其稳定 check 配置为分支保护门槛（工作流本身不修改分支保护）。触发范围：PR、main push、每日定时与 `workflow_dispatch`。无 `continue-on-error`。

本轮未涵盖：真实模型调用、邮件发送、Turnstile/Tencent/阿里云验证码供应商、支付渠道交易与 webhook 签名。这些仍需在真实部署/沙箱中单独验证；mock 支付成功场景仅属于本地 UI 验收，不代表真实兼容性。
