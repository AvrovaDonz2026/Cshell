# 第三方声明

## Sub2API

- 上游：<https://github.com/Wei-Shaw/sub2api>
- 复制基线：[`2af3f1e15c98c893a89255a037f551046883b8c0`](https://github.com/Wei-Shaw/sub2api/tree/2af3f1e15c98c893a89255a037f551046883b8c0)
- 上游 README 版权声明：Copyright (c) 2026 Wesley Liddick.
- 上游 README 指定许可：GNU Lesser General Public License version 3 or later（`LGPL-3.0-or-later`）。[LICENSE](LICENSE) 包含 LGPL v3 原文及其引用的 GPL v3 原文。

Cshell 的 `frontend/` 从上述提交复制并修改。主要改动为界面视觉和布局，以及与 Cshell 静态资源和路由部署的集成；这是 Cshell 的修改版本，不代表上游发布或背书。复制的源文件和资源中的原有版权与许可声明仍适用。独立运行的 Sub2API 服务不打包进本项目的 Cshell 镜像。

## 分发构建产物

部署页面会向浏览器发送构建后的 JS/CSS；发布镜像也会分发这些文件。提供镜像或构建后的前端时，应依照适用的 LGPL/GPL 条款，随发行提供上述许可文本、归属和修改说明，并以许可允许的方式向接收者提供该发行版本的完整对应源代码。源码应包含 Cshell 实际使用的修改后前端、构建配置、锁文件及生成对应产物所需的相关脚本和材料。仅链接原始 Sub2API 提交无法提供 Cshell 的修改后源码。发布者可在下载页或镜像说明标注可访问的对应源码归档或准确的版本/提交，并确保部署前端的访问者也能找到对应的许可与源码信息。

如果再分发引入其他组合、链接或安装限制，按实际分发方式核对许可证中的相应条件；这份声明不是对任何组合的额外许可，也不改变独立依赖的原有条款。

## 依赖与资源

Vue、Rust crate、NPM 依赖、支付 SDK、字体、图标和镜像基础系统包各自受其许可、使用条款或商标规则约束。依赖的实际版本见 `frontend/pnpm-lock.yaml` 与 `Cargo.lock`；查阅相应版本所附的 `LICENSE` / `NOTICE`，并在对外发布最终前端 bundle 或镜像时保留应随产物交付的第三方声明。此文件不替代依赖附带的声明，也不授予任何第三方商标权。
