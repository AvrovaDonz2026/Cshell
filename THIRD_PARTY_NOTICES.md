# 第三方声明

## 当前发行模型

当前工作树中的 Cshell 原创材料（Rust 代理、构建与配套工具、独立 `web/` 用户界面源码）按根目录 [LICENSE](LICENSE) 的 MIT 条款发布。`web/` 的直接 npm 依赖保持各自许可证，清单见 [web/docs/web-third-party.md](web/docs/web-third-party.md)。**当前树不再附带或声称分发基于 Sub2API 的修改版前端源码。**

Sub2API 仍是独立产品：部署时由运维单独运行，并通过 `SUB2API_UPSTREAM` 由 Cshell 反向代理访问。独立运行的 Sub2API 服务及其自带前端不打包进本项目的 Cshell 镜像源码树。

## Sub2API（独立上游）

- 上游：<https://github.com/Wei-Shaw/sub2api>
- 兼容基线提交：[`2af3f1e15c98c893a89255a037f551046883b8c0`](https://github.com/Wei-Shaw/sub2api/tree/2af3f1e15c98c893a89255a037f551046883b8c0)
- 上游 README 版权声明：Copyright (c) 2026 Wesley Liddick.
- 上游 README 指定许可：GNU Lesser General Public License version 3 or later（`LGPL-3.0-or-later`）。

Cshell 通过 HTTP(S) 同源代理调用该上游的 API 与管理入口；这不构成对 Sub2API 源码的再许可，也不代表上游发布或背书。

## 历史说明（简要）

过去曾随 Cshell 发行、并将修改后的 Vue 前端置于仓库 `frontend/` 目录的版本，属于 Sub2API 衍生材料，适用 LGPL-3.0-or-later。该目录已从当前工作树移除；**未改写 git 历史**。既往发行物与历史对象中的义务不因当前树切换到独立 `web/` 而消失。详见 [HISTORY-LICENSE.md](HISTORY-LICENSE.md) 与 [docs/provenance.md](docs/provenance.md)。

## 分发构建产物

发布镜像或构建后的 `web/dist` 时，应保留根目录 MIT 许可文本、本声明，以及 `web` 第三方依赖所要求的声明（见 `web/docs/web-third-party.md` 与各包自带 `LICENSE` / `NOTICE`）。不要把第三方 npm/crate 许可误当作 MIT 仅因 Cshell 原创源码为 MIT。

## 依赖与资源

Vue、Rust crate、NPM 依赖、支付 SDK、字体、图标和镜像基础系统包各自受其许可、使用条款或商标规则约束。当前前端依赖的实际版本见 `web/pnpm-lock.yaml`；Rust 依赖见 `Cargo.lock`。查阅相应版本所附的 `LICENSE` / `NOTICE`，并在对外发布最终前端 bundle 或镜像时保留应随产物交付的第三方声明。此文件不替代依赖附带的声明，也不授予任何第三方商标权。
