# mcp-demo
mcp demo for studying mcp, include client and server
mcp-project/
  ├── common/                     # 共享模块（工具、类型、配置等）
  │   ├── config/                 # 通用配置模块
  │   │   ├── index.ts            # 配置加载逻辑
  │   │   └── types.ts            # 配置相关类型
  │   ├── types/                  # 通用类型定义
  │   │   ├── index.ts            # 类型导出入口
  │   │   └── toolContext.ts      # 工具上下文类型
  │   └── utils/                  # 通用工具函数
  │       ├── index.ts            # 工具函数导出入口
  │       └── markdown.ts         # Markdown 清理工具
  ├── mcp-client/                 # MCP 客户端项目
  │   ├── src/                    # 客户端源代码
  │   │   ├── app/                # 应用层（入口和交互逻辑）
  │   │   │   ├── client.ts       # 客户端主入口
  │   │   │   └── chatLoop.ts     # 交互循环逻辑
  │   │   ├── core/               # 核心业务逻辑层
  │   │   │   ├── llm/            # LLM 交互模块
  │   │   │   │   ├── index.ts    # LLM 客户端逻辑
  │   │   │   │   └── types.ts    # LLM 相关类型
  │   │   │   ├── query/          # 查询处理模块
  │   │   │   │   ├── index.ts    # 查询处理逻辑
  │   │   │   │   └── types.ts    # 查询相关类型
  │   │   │   └── template/       # 模板列出模块
  │   │   │       ├── index.ts    # 模板列出逻辑
  │   │   │       └── types.ts    # 模板相关类型
  │   │   └── infra/              # 基础设施层（服务器连接、外部服务）
  │   │       ├── server/         # 服务器连接模块
  │   │       │   ├── index.ts    # 服务器连接逻辑
  │   │       │   └── types.ts    # 服务器相关类型
  │   │       └── transport/      # 传输层（stdio、sse 等）
  │   │           └── index.ts    # 传输层逻辑
  │   ├── .env                    # 环境变量文件
  │   ├── tsconfig.json           # TypeScript 配置文件
  │   └── package.json            # 项目依赖
  ├── mcp-server/                 # MCP 服务器项目
  │   ├── src/                    # 服务器源代码
  │   │   ├── app/                # 应用层（入口和路由）
  │   │   │   ├── server.ts       # 服务器主入口
  │   │   │   └── routes.ts       # Express 路由
  │   │   ├── core/               # 核心业务逻辑层
  │   │   │   ├── handlers/       # 请求处理模块
  │   │   │   │   ├── tool/       # 工具相关处理
  │   │   │   │   │   ├── index.ts
  │   │   │   │   │   └── types.ts
  │   │   │   │   ├── resource/   # 资源相关处理
  │   │   │   │   │   ├── index.ts
  │   │   │   │   │   └── types.ts
  │   │   │   │   └── prompt/     # Prompt 相关处理
  │   │   │   │       ├── index.ts
  │   │   │   │       └── types.ts
  │   │   │   └── prompts/        # Prompt 数据模块
  │   │   │       ├── index.ts    # Prompt 数据定义
  │   │   │       └── types.ts    # Prompt 相关类型
  │   │   └── infra/              # 基础设施层（数据库、日志、工具）
  │   │       ├── mysql/          # MySQL 数据库访问
  │   │       │   ├── index.ts
  │   │       │   └── types.ts
  │   │       ├── logger/         # 日志模块
  │   │       │   ├── index.ts
  │   │       │   └── types.ts
  │   │       └── tools/          # 工具模块
  │   │           ├── index.ts
  │   │           └── types.ts
  │   ├── .env                    # 环境变量文件
  │   ├── tsconfig.json           # TypeScript 配置文件
  │   └── package.json            # 项目依赖
  ├── .gitignore                  # Git 忽略文件
  └── README.md                   # 项目说明

1. 总体分层
应用层（app）：负责程序的入口和用户交互逻辑，例如 client.ts 和 server.ts。
核心业务逻辑层（core）：包含业务逻辑，例如查询处理、模板列出、请求处理等。
基础设施层（infra）：处理底层服务，例如服务器连接、数据库访问、日志记录等。
共享模块（common）：包含多个项目共享的配置、类型和工具函数。
2. 具体目录说明
common/：
config/：通用配置加载逻辑，供 mcp-client 和 mcp-server 复用。
types/：通用类型定义，例如 ToolContext。
utils/：通用工具函数，例如 Markdown 清理。
mcp-client/src/：
app/：客户端入口和交互循环。
core/：核心业务逻辑，包括 LLM 交互、查询处理和模板列出。
infra/：基础设施，包括服务器连接和传输层。
mcp-server/src/：
app/：服务器入口和 Express 路由。
core/：核心业务逻辑，包括请求处理和 Prompt 数据。
infra/：基础设施，包括 MySQL 访问、日志和工具。
