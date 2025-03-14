import dotenv from "dotenv";

// 加载环境变量（只在此处调用一次）
dotenv.config();

export const config = {
  mysql: {
    host: process.env.MYSQL_HOST || "localhost",
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || "test_db",
  },
  port: process.env.PORT || "8080",
};