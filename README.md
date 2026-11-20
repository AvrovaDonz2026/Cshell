# Cshell

Cshell 是部署在 [Sub2API](https://github.com/Wei-Shaw/sub2api) 前面的 Rust 反向代理和 Vue 用户界面。本项目以固定提交 [`2af3f1e`](https://github.com/Wei-Shaw/sub2api/tree/2af3f1e15c98c893a89255a037f551046883b8c0) 为兼容基线：用户界面从上游 Vue 源码改版，继续使用原有 API 和登录、订阅、订单等业务逻辑。用户、权限、余额、支付、会话和持久化数据均由 Sub2API 管理；Cshell 不需要数据库、Redis 或独立账号。

Cshell 只在明确允许的页面路径返回新版界面，构建资源位于 `/_cshell/`。原版管理后台 `/admin`、初始化向导 `/setup`、API、模型网关及其他路径均交给固定的 Sub2API 实例处理。上游需要提供原版内嵌前端，才能访问原版管理后台和初始化向导。

## Docker Compose

先准备已运行的 Sub2API；示例只启动 Cshell。将示例配置复制为 `.env`，并按下述网络方式设置上游地址。

```sh
cp .env.example .env
# 编辑 .env 后运行：
docker compose -f compose.example.yml up --build -d
curl -fsS http://127.0.0.1:8080/_cshell/health
curl -fsS http://127.0.0.1:8080/_cshell/ready
```

- **Sub2API 运行在宿主机**：`SUB2API_UPSTREAM=http://host.docker.internal:8081` 是示例，替换端口。Compose 用 Linux Docker 的 `host-gateway` 映射提供这个地址。上游监听地址必须可从容器网桥到达；仅在宿主机的 `127.0.0.1` 监听的服务对容器不可达。限制防火墙访问范围，避免为了连容器而直接开放上游到公网。
- **Sub2API 运行在另一组容器**：设置 `CSHELL_NETWORK_EXTERNAL=true`，把 `CSHELL_NETWORK` 设置为现有共享网络的实际名称。若上游容器在该网络上的 DNS 别名为 `sub2api`、容器端口为 `8080`，设置 `SUB2API_UPSTREAM=http://sub2api:8080`。无需把上游端口发布到宿主机；这里用容器端口。
- **生产入口**：默认只发布到宿主机 `127.0.0.1:8080`，便于宿主机上的 HTTPS 反向代理接入。若入口也运行在容器内，让它通过共享网络访问 Cshell；需要调整宿主机映射时使用 `CSHELL_HOST_BIND` 和 `CSHELL_HOST_PORT`。容器内部监听仍为 `0.0.0.0:8080`，镜像的健康检查依赖该端口。

`/_cshell/health` 用于存活检查，`/_cshell/ready` 用于判定是否适合接收流量。镜像健康检查用前者，避免上游暂时不可达时把 Cshell 进程误判为失活。上游 `/health` 仍由 Sub2API 处理。

## 本地构建

准备 Node.js 24、pnpm 9.15.9 和 Rust 1.93 或兼容更新版本。在仓库根目录执行：

```sh
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm --dir frontend install --frozen-lockfile
pnpm --dir frontend run build
cargo build --release --locked --bin cshell
SUB2API_UPSTREAM=http://127.0.0.1:8081 ./target/release/cshell
```

将示例端口改为现有 Sub2API 的端口，然后访问 `http://127.0.0.1:8080/`。默认静态目录 `frontend/dist` 相对进程工作目录。Compose 会读取 `.env` 做变量替换；本地二进制请直接设置进程环境变量。

## 运行参数

- `SUB2API_UPSTREAM`（必填）：固定上游 HTTP(S) origin，例如 `http://sub2api:8080`。不要附加路径、查询、片段或登录凭据。
- `CSHELL_PUBLIC_URL`（可选）：浏览器访问的公开 origin，例如 `https://panel.example.com`。生产建议明确配置为对外 HTTPS 域名；不要附加路径。它不会替你在 Sub2API 或第三方平台登记回调。
- `CSHELL_LISTEN`：监听地址，默认 `0.0.0.0:8080`。本机开发可改成 `127.0.0.1:8080`。
- `CSHELL_STATIC_DIR`：新版前端目录，默认 `frontend/dist`；镜像内为 `/app/frontend/dist`。
- `CSHELL_CONNECT_TIMEOUT_SECS`：建立上游连接的超时，默认 `5`，允许 `1` 到 `300`。
- `CSHELL_TRUSTED_PROXY_CIDRS`：可选的逗号分隔 IPv4/IPv6 CIDR，默认不信任任何入口；只有来自这些网段的入口才会被信任其转发头。

## 登录、隐私与入口配置

页面通过同源 `/api/v1` 与 Sub2API 通信。上游前端在浏览器 `localStorage` 保存 access token、refresh token 和用户信息，并用 `Authorization: Bearer …` 调用 API；部分流程还使用 `sessionStorage` 或上游 Cookie。新版界面与原版后台同源时共享该浏览器存储，但管理员权限仍由上游判定。迁移到新域名不会迁移旧站点的浏览器会话，用户通常需要重新登录。

所有用户业务都由 Sub2API API 完成：注册、登录、OAuth、用户资料、API Key 管理、模型广场、用量、订阅、余额充值、订单核验、兑换码和支付回调分别通过上游 `/api/v1/*` 接口处理。Cshell 不创建或修改这些业务数据，也不保存本地数据库、Redis、支付订单或账号状态；浏览器只访问 Cshell 的同源路径，由 Rust 代理原样转发到 `SUB2API_UPSTREAM`。`/v1/*` 则是同一上游的 AI 网关路径，支持流式响应和 WebSocket 透传。

生产应使用专用 HTTPS 域名，不要与不受信任的应用共用 origin。代理或日志系统不要记录 Authorization、Cookie、支付/身份回调内容或带凭据的查询字符串。不要把会话令牌、API 密钥或支付密钥放进 `VITE_*`；这些值可进入浏览器包。

入口应保持原始路径和查询，转发正确的公开 Host / HTTPS scheme，并清理外部请求自己提供的 `Forwarded`、`X-Forwarded-*` 等代理头。只信任实际的代理链，并在 Sub2API 中核对 `server.trusted_proxies`、会话绑定与客户端 IP 配置，避免用户会话、限流或审计使用错误的 IP。使用流式网关时检查入口不会缓存或缓冲流式响应，并设置适合业务的超时。

OAuth 服务端回调通常是 `/api/v1/auth/oauth/<provider>/callback`；身份验证后的页面回调是 `/auth/.../callback`。按各提供商和 Sub2API 实际配置逐项登记完整 URL。Passkey 要求浏览器可用的安全上下文和一致的 RP ID / origin；上线前在最终 HTTPS 域名验证已有及新注册凭据。保持原版页面的 CSP 行为；如由入口为 Cshell 页面统一配置 CSP，应逐项验证允许的脚本、连接、窗口和第三方支付 iframe，避免通配放开或覆盖上游动态策略。

## 支付回跳与通知

用户从供应商返回的页面（如 `/payment/result`）和商户服务器通知（`/api/v1/payment/webhook/<provider>`）是不同的地址。如果更新公网域名，在 Sub2API 和供应商后台分别登记原路径的完整 HTTPS URL；保留上游规定的方法、查询参数、请求体和签名相关请求头。不要在代理中解析后重写签名内容，不要把通知转成页面重定向。订单核验、履约、余额入账与退款由 Sub2API 负责。

部署前请用测试账号和供应商沙箱按 [兼容性清单](docs/compatibility.md) 核对；当前文档不代表已联通真实支付或身份服务。

## 许可证

上游复制及改版的前端沿用 GNU LGPL v3 或后续版本。详见 [LICENSE](LICENSE) 与 [第三方声明](THIRD_PARTY_NOTICES.md)，其中列出上游归属与分发时提供对应源代码的要求。
